/**
 * TITAN WhatsApp Bot - Main Entry Point
 * A powerful private WhatsApp bot using @whiskeysockets/baileys
 * Designed for Render.com free tier deployment
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const moment = require('moment');

// ==================== CONFIGURATION ====================
const config = {
    ownerNumber: process.env.OWNER_NUMBER || '234xxxxxxxxxx', // CHANGE THIS
    botName: process.env.BOT_NAME || 'TITAN',
    prefix: process.env.PREFIX || '.',
    mode: process.env.MODE || 'private', // private, groups, self
    port: process.env.PORT || 3000,
    
    // Paths
    authPath: './auth_info',
    dataPath: './data',
    downloadPath: './downloads',
    logoPath: './titan_logo.png'
};

// ==================== LOGGER ====================
const logger = pino({ level: 'silent' }); // Set to 'info' for debugging

// ==================== DATA STORAGE ====================
const dataFiles = {
    settings: path.join(config.dataPath, 'settings.json'),
    groups: path.join(config.dataPath, 'groups.json'),
    users: path.join(config.dataPath, 'users.json'),
    messages: path.join(config.dataPath, 'messages.json'),
    quickReplies: path.join(config.dataPath, 'quickreplies.json')
};

// Ensure directories exist
fs.ensureDirSync(config.authPath);
fs.ensureDirSync(config.dataPath);
fs.ensureDirSync(config.downloadPath);

// Load/Save data functions
const loadData = (file, defaultData = {}) => {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { console.error(`Error loading ${file}:`, e.message); }
    return defaultData;
};

const saveData = (file, data) => {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error(`Error saving ${file}:`, e.message); }
};

// Global data objects
let settings = loadData(dataFiles.settings, { prefix: config.prefix, mode: config.mode, allowedUsers: [] });
let groups = loadData(dataFiles.groups, {});
let users = loadData(dataFiles.users, {});
let messageStore = loadData(dataFiles.messages, {});
let quickReplies = loadData(dataFiles.quickReplies, {});

// Anti-spam tracking
const spamTracker = new Map();
const onlineUsers = new Map();

// Bot start time for uptime
const startTime = Date.now();

// ==================== EXPRESS SERVER ====================
const app = express();
app.get('/', (req, res) => {
    const uptime = moment.duration(Date.now() - startTime).humanize();
    res.send(`
        <html>
        <head><title>TITAN Bot</title></head>
        <body style="background:#1a1a2e;color:#00f5d4;font-family:Arial;text-align:center;padding:50px;">
            <h1>🤖 TITAN WhatsApp Bot</h1>
            <p>Status: <span style="color:#0f0;">ONLINE</span></p>
            <p>Uptime: ${uptime}</p>
            <p>Connected Groups: ${Object.keys(groups).length}</p>
        </body>
        </html>
    `);
});
app.listen(config.port, '0.0.0.0', () => console.log(`[TITAN] Web server running on port ${config.port}`));

// ==================== HELPER FUNCTIONS ====================
const getOwnerJid = () => `${config.ownerNumber}@s.whatsapp.net`;
const isOwner = (jid) => jid === getOwnerJid() || settings.allowedUsers?.includes(jid);
const isGroup = (jid) => jid?.endsWith('@g.us');
const isConnectedGroup = (jid) => groups[jid]?.connected === true;
const getPrefix = (jid) => groups[jid]?.prefix || settings.prefix || config.prefix;

const getMessageText = (msg) => {
    const m = msg.message;
    if (!m) return '';
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || 
           m.videoMessage?.caption || m.documentMessage?.caption || '';
};

const getQuotedMessage = (msg) => {
    return msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
};

const getMentionedJids = (msg) => {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
};

const extractNumbers = (text) => {
    const matches = text.match(/\d+/g);
    return matches ? matches.map(n => n + '@s.whatsapp.net') : [];
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ==================== MAIN BOT FUNCTION ====================
async function startTitan() {
    console.log(`
╔══════════════════════════════════════════╗
║     ████████╗██╗████████╗ █████╗ ███╗   ██╗    ║
║     ╚══██╔══╝██║╚══██╔══╝██╔══██╗████╗  ██║    ║
║        ██║   ██║   ██║   ███████║██╔██╗ ██║    ║
║        ██║   ██║   ██║   ██╔══██║██║╚██╗██║    ║
║        ██║   ██║   ██║   ██║  ██║██║ ╚████║    ║
║        ╚═╝   ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝    ║
║            WhatsApp Bot v1.0.0                 ║
╚══════════════════════════════════════════╝
    `);
    
    const { state, saveCreds } = await useMultiFileAuthState(config.authPath);
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: Browsers.macOS('Chrome'),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        getMessage: async (key) => messageStore[key.id] || { conversation: '' }
    });
    
    // Pairing code logic
    let pairingRequested = false;
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if ((connection === 'connecting' || qr) && !state.creds.registered && !pairingRequested) {
            pairingRequested = true;
            console.log('\n[TITAN] Requesting pairing code...');
            console.log(`[TITAN] Owner number: ${config.ownerNumber}`);
            
            try {
                await sleep(3000);
                const code = await sock.requestPairingCode(config.ownerNumber);
                console.log(`\n╔════════════════════════════════════╗`);
                console.log(`║   PAIRING CODE: ${code}              ║`);
                console.log(`╠════════════════════════════════════╣`);
                console.log(`║ Open WhatsApp > Linked Devices      ║`);
                console.log(`║ > Link a Device > Link with         ║`);
                console.log(`║ phone number > Enter this code      ║`);
                console.log(`╚════════════════════════════════════╝\n`);
            } catch (e) {
                console.error('[TITAN] Pairing error:', e.message);
            }
        }
        
        if (connection === 'open') {
            console.log('[TITAN] ✅ Connected to WhatsApp!');
            pairingRequested = false;
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[TITAN] Connection closed. Reason: ${reason}`);
            
            if (reason !== DisconnectReason.loggedOut) {
                console.log('[TITAN] Reconnecting...');
                await sleep(5000);
                startTitan();
            } else {
                console.log('[TITAN] Logged out. Delete auth_info folder and restart.');
            }
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // ==================== MESSAGE HANDLER ====================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            try {
                if (!msg.message || msg.key.fromMe) continue;
                
                const jid = msg.key.remoteJid;
                const sender = msg.key.participant || jid;
                const text = getMessageText(msg).trim();
                const isGroupMsg = isGroup(jid);
                
                // Store message for anti-delete
                messageStore[msg.key.id] = msg.message;
                if (Object.keys(messageStore).length > 1000) {
                    const keys = Object.keys(messageStore).slice(0, 500);
                    keys.forEach(k => delete messageStore[k]);
                }
                saveData(dataFiles.messages, messageStore);
                
                // Privacy check
                if (settings.mode === 'self') continue;
                
                if (isGroupMsg) {
                    if (!isConnectedGroup(jid)) continue;
                    if (!isOwner(sender)) {
                        // Handle anti-features for non-owner
                        await handleAntiFeatures(sock, msg, jid, sender, text);
                        continue;
                    }
                } else {
                    if (!isOwner(sender)) continue;
                }
                
                // Auto-download media from owner
                if (isOwner(sender) && msg.message) {
                    await autoDownloadMedia(sock, msg);
                }
                
                // Command handling
                const prefix = getPrefix(jid);
                if (!text.startsWith(prefix)) {
                    // Quick replies
                    if (quickReplies[text.toLowerCase()]) {
                        await sendWithLogo(sock, jid, quickReplies[text.toLowerCase()]);
                    }
                    continue;
                }
                
                const args = text.slice(prefix.length).trim().split(/\s+/);
                const cmd = args.shift().toLowerCase();
                
                await handleCommand(sock, msg, jid, sender, cmd, args, text);
                
            } catch (e) {
                console.error('[TITAN] Message error:', e);
            }
        }
    });
    
    // ==================== ANTI-DELETE ====================
    sock.ev.on('messages.delete', async (update) => {
        try {
            if (update.keys) {
                for (const key of update.keys) {
                    const stored = messageStore[key.id];
                    if (stored) {
                        const text = stored.conversation || stored.extendedTextMessage?.text || '[Media]';
                        await sock.sendMessage(getOwnerJid(), {
                            text: `🗑️ *Deleted Message Detected*\n\nFrom: ${key.remoteJid}\nMessage: ${text}`
                        });
                    }
                }
            }
        } catch (e) { console.error('[TITAN] Anti-delete error:', e); }
    });
    
    // ==================== GROUP UPDATES ====================
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (!isConnectedGroup(id)) return;
        const groupSettings = groups[id] || {};
        
        try {
            const metadata = await sock.groupMetadata(id);
            
            for (const participant of participants) {
                if (action === 'add' && groupSettings.welcome?.enabled) {
                    const welcomeText = (groupSettings.welcome.text || 'Welcome {user} to {group}!')
                        .replace(/{user}/g, `@${participant.split('@')[0]}`)
                        .replace(/{group}/g, metadata.subject)
                        .replace(/{time}/g, moment().format('LLL'));
                    
                    await sendWithLogo(sock, id, welcomeText, [participant]);
                }
                
                if ((action === 'remove' || action === 'leave') && groupSettings.goodbye?.enabled) {
                    const goodbyeText = (groupSettings.goodbye.text || 'Goodbye {user}!')
                        .replace(/{user}/g, `@${participant.split('@')[0]}`)
                        .replace(/{group}/g, metadata.subject);
                    
                    await sock.sendMessage(id, { text: goodbyeText, mentions: [participant] });
                }
                
                // Ban enforcement
                if (action === 'add' && users[participant]?.banned) {
                    await sock.groupParticipantsUpdate(id, [participant], 'remove');
                    await sock.sendMessage(id, { text: '🚫 Banned user tried to rejoin. Removed.' });
                }
            }
        } catch (e) { console.error('[TITAN] Group update error:', e); }
    });
    
    return sock;
}

// ==================== SEND WITH LOGO ====================
async function sendWithLogo(sock, jid, text, mentions = []) {
    try {
        if (fs.existsSync(config.logoPath)) {
            await sock.sendMessage(jid, {
                image: fs.readFileSync(config.logoPath),
                caption: `*「 ${config.botName} 」*\n\n${text}`,
                mentions
            });
        } else {
            await sock.sendMessage(jid, { text: `*「 ${config.botName} 」*\n\n${text}`, mentions });
        }
    } catch (e) {
        await sock.sendMessage(jid, { text: `*「 ${config.botName} 」*\n\n${text}`, mentions });
    }
}

// ==================== ANTI-FEATURES ====================
async function handleAntiFeatures(sock, msg, jid, sender, text) {
    const groupSettings = groups[jid] || {};
    
    // Anti-link
    if (groupSettings.antilink?.enabled) {
        const linkPattern = /(https?:\/\/[^\s]+|wa\.me|chat\.whatsapp\.com)/gi;
        if (linkPattern.test(text)) {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
                users[sender] = users[sender] || { warnings: 0 };
                users[sender].warnings++;
                saveData(dataFiles.users, users);
                
                if (users[sender].warnings >= 3) {
                    await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                    await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]} removed for posting links.`, mentions: [sender] });
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]} links not allowed! Warning ${users[sender].warnings}/3`, mentions: [sender] });
                }
            } catch (e) { console.error('[TITAN] Antilink error:', e); }
            return;
        }
    }
    
    // Anti-spam
    if (groupSettings.antispam?.enabled) {
        const now = Date.now();
        const key = `${jid}:${sender}`;
        const tracker = spamTracker.get(key) || { count: 0, first: now };
        
        if (now - tracker.first > 60000) {
            tracker.count = 1;
            tracker.first = now;
        } else {
            tracker.count++;
        }
        spamTracker.set(key, tracker);
        
        if (tracker.count > 5) {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
                await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]} stop spamming!`, mentions: [sender] });
            } catch (e) { console.error('[TITAN] Antispam error:', e); }
        }
    }
    
    // Anti view-once
    if (groupSettings.antivv?.enabled) {
        const viewOnce = msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2;
        if (viewOnce) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                await sock.sendMessage(getOwnerJid(), {
                    image: buffer,
                    caption: `👁️ View-once from ${jid}\nSender: ${sender}`
                });
            } catch (e) { console.error('[TITAN] AntiVV error:', e); }
        }
    }
}

// ==================== AUTO DOWNLOAD ====================
async function autoDownloadMedia(sock, msg) {
    try {
        const types = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
        for (const type of types) {
            if (msg.message[type]) {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const ext = type === 'imageMessage' ? 'jpg' : type === 'videoMessage' ? 'mp4' : type === 'audioMessage' ? 'mp3' : 'bin';
                const filename = `${Date.now()}.${ext}`;
                fs.writeFileSync(path.join(config.downloadPath, filename), buffer);
                console.log(`[TITAN] Downloaded: ${filename}`);
                break;
            }
        }
    } catch (e) { /* silently fail */ }
}

// ==================== COMMAND HANDLER ====================
async function handleCommand(sock, msg, jid, sender, cmd, args, fullText) {
    const prefix = getPrefix(jid);
    const isGroupMsg = isGroup(jid);
    
    const commands = {
        // ========== INFO ==========
        menu: async () => {
            const menuText = `
╔═══════════════════════════
║ *${config.botName} MENU*
╠═══════════════════════════
║ *📊 INFO*
║ ${prefix}menu - Show this menu
║ ${prefix}status - Bot status
║ ${prefix}ping - Check latency
║
║ *👥 GROUP MANAGEMENT*
║ ${prefix}connectgroup - Enable bot
║ ${prefix}disconnectgroup - Disable bot
║ ${prefix}tagall [msg] - Tag everyone
║ ${prefix}tagonline - Tag online users
║ ${prefix}kick @user - Kick member
║ ${prefix}ban @user - Ban member
║ ${prefix}mute @user [min] - Mute
║ ${prefix}promote @user - Make admin
║ ${prefix}demote @user - Remove admin
║ ${prefix}add [number] - Add member
║ ${prefix}link - Get invite link
║
║ *🛡️ ANTI FEATURES*
║ ${prefix}antilink on/off
║ ${prefix}antispam on/off
║ ${prefix}antivv on/off
║
║ *👋 GREETINGS*
║ ${prefix}welcome on/off/set [text]
║ ${prefix}goodbye on/off/set [text]
║
║ *🎨 MEDIA*
║ ${prefix}sticker - Make sticker
║ ${prefix}toimg - Sticker to image
║ ${prefix}vv - Save view-once
║
║ *⚙️ SETTINGS*
║ ${prefix}setprefix [new]
║ ${prefix}mode [private/groups]
║ ${prefix}setreply [key] [value]
║ ${prefix}backup - Export data
║ ${prefix}restore - Import data
║
║ *💫 PRESENCE*
║ ${prefix}online - Show online
║ ${prefix}typing - Show typing
║ ${prefix}recording - Show recording
╚═══════════════════════════`;
            await sendWithLogo(sock, jid, menuText);
        },
        
        help: async () => await commands.menu(),
        
        status: async () => {
            const uptime = moment.duration(Date.now() - startTime).humanize();
            const connectedGroups = Object.keys(groups).filter(g => groups[g].connected).length;
            await sendWithLogo(sock, jid, `
📊 *${config.botName} Status*

⏱️ Uptime: ${uptime}
👥 Connected Groups: ${connectedGroups}
📝 Prefix: ${prefix}
🔒 Mode: ${settings.mode}
🤖 Version: 1.0.0`);
        },
        
        ping: async () => {
            const start = Date.now();
            await sock.sendMessage(jid, { text: '🏓 Pinging...' });
            await sendWithLogo(sock, jid, `🏓 Pong! ${Date.now() - start}ms`);
        },
        
        // ========== GROUP MANAGEMENT ==========
        connectgroup: async () => {
            if (!isGroupMsg) return await sendWithLogo(sock, jid, '❌ Use in a group!');
            groups[jid] = groups[jid] || {};
            groups[jid].connected = true;
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, '✅ Group connected! Bot is now active here.');
        },
        
        enable: async () => await commands.connectgroup(),
        
        disconnectgroup: async () => {
            if (!isGroupMsg) return await sendWithLogo(sock, jid, '❌ Use in a group!');
            if (groups[jid]) groups[jid].connected = false;
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, '✅ Group disconnected.');
        },
        
        tagall: async () => {
            if (!isGroupMsg) return;
            try {
                const metadata = await sock.groupMetadata(jid);
                const participants = metadata.participants.map(p => p.id);
                const mentions = participants.map(p => `@${p.split('@')[0]}`).join(' ');
                const customMsg = args.join(' ') || '📢 Attention everyone!';
                await sock.sendMessage(jid, { text: `${customMsg}\n\n${mentions}`, mentions: participants });
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        kick: async () => {
            if (!isGroupMsg) return;
            const mentioned = getMentionedJids(msg);
            if (!mentioned.length) return await sendWithLogo(sock, jid, '❌ Mention someone to kick!');
            try {
                await sock.groupParticipantsUpdate(jid, mentioned, 'remove');
                await sendWithLogo(sock, jid, '✅ User kicked!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        ban: async () => {
            if (!isGroupMsg) return;
            const mentioned = getMentionedJids(msg);
            if (!mentioned.length) return await sendWithLogo(sock, jid, '❌ Mention someone to ban!');
            for (const u of mentioned) {
                users[u] = users[u] || {};
                users[u].banned = true;
            }
            saveData(dataFiles.users, users);
            try {
                await sock.groupParticipantsUpdate(jid, mentioned, 'remove');
                await sendWithLogo(sock, jid, '✅ User banned!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        mute: async () => {
            if (!isGroupMsg) return;
            const mentioned = getMentionedJids(msg);
            if (!mentioned.length) return await sendWithLogo(sock, jid, '❌ Mention someone!');
            const duration = parseInt(args[0]) || 5;
            for (const u of mentioned) {
                users[u] = users[u] || {};
                users[u].muted = Date.now() + (duration * 60000);
            }
            saveData(dataFiles.users, users);
            await sendWithLogo(sock, jid, `✅ User muted for ${duration} minutes!`);
        },
        
        promote: async () => {
            if (!isGroupMsg) return;
            const mentioned = getMentionedJids(msg);
            if (!mentioned.length) return await sendWithLogo(sock, jid, '❌ Mention someone!');
            try {
                await sock.groupParticipantsUpdate(jid, mentioned, 'promote');
                await sendWithLogo(sock, jid, '✅ User promoted to admin!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        demote: async () => {
            if (!isGroupMsg) return;
            const mentioned = getMentionedJids(msg);
            if (!mentioned.length) return await sendWithLogo(sock, jid, '❌ Mention someone!');
            try {
                await sock.groupParticipantsUpdate(jid, mentioned, 'demote');
                await sendWithLogo(sock, jid, '✅ User demoted!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        add: async () => {
            if (!isGroupMsg) return;
            const numbers = extractNumbers(args.join(' '));
            if (!numbers.length) return await sendWithLogo(sock, jid, '❌ Provide a number!');
            try {
                await sock.groupParticipantsUpdate(jid, numbers, 'add');
                await sendWithLogo(sock, jid, '✅ User added!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        link: async () => {
            if (!isGroupMsg) return;
            try {
                const code = await sock.groupInviteCode(jid);
                await sendWithLogo(sock, jid, `🔗 https://chat.whatsapp.com/${code}`);
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        muteall: async () => {
            if (!isGroupMsg) return;
            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                await sendWithLogo(sock, jid, '✅ Only admins can send messages now!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        unmuteall: async () => {
            if (!isGroupMsg) return;
            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                await sendWithLogo(sock, jid, '✅ Everyone can send messages now!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        // ========== ANTI FEATURES ==========
        antilink: async () => {
            if (!isGroupMsg) return;
            const state = args[0]?.toLowerCase();
            groups[jid] = groups[jid] || {};
            groups[jid].antilink = { enabled: state === 'on' };
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, `✅ Antilink ${state === 'on' ? 'enabled' : 'disabled'}!`);
        },
        
        antispam: async () => {
            if (!isGroupMsg) return;
            const state = args[0]?.toLowerCase();
            groups[jid] = groups[jid] || {};
            groups[jid].antispam = { enabled: state === 'on' };
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, `✅ Antispam ${state === 'on' ? 'enabled' : 'disabled'}!`);
        },
        
        antivv: async () => {
            if (!isGroupMsg) return;
            const state = args[0]?.toLowerCase();
            groups[jid] = groups[jid] || {};
            groups[jid].antivv = { enabled: state === 'on' };
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, `✅ Anti view-once ${state === 'on' ? 'enabled' : 'disabled'}!`);
        },
        
        // ========== GREETINGS ==========
        welcome: async () => {
            if (!isGroupMsg) return;
            const action = args[0]?.toLowerCase();
            groups[jid] = groups[jid] || {};
            groups[jid].welcome = groups[jid].welcome || {};
            
            if (action === 'on') groups[jid].welcome.enabled = true;
            else if (action === 'off') groups[jid].welcome.enabled = false;
            else if (action === 'set') groups[jid].welcome.text = args.slice(1).join(' ');
            
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, `✅ Welcome message updated!\nPlaceholders: {user}, {group}, {time}`);
        },
        
        goodbye: async () => {
            if (!isGroupMsg) return;
            const action = args[0]?.toLowerCase();
            groups[jid] = groups[jid] || {};
            groups[jid].goodbye = groups[jid].goodbye || {};
            
            if (action === 'on') groups[jid].goodbye.enabled = true;
            else if (action === 'off') groups[jid].goodbye.enabled = false;
            else if (action === 'set') groups[jid].goodbye.text = args.slice(1).join(' ');
            
            saveData(dataFiles.groups, groups);
            await sendWithLogo(sock, jid, '✅ Goodbye message updated!');
        },
        
        // ========== MEDIA ==========
        sticker: async () => {
            const quoted = getQuotedMessage(msg);
            const mediaMsg = quoted || msg.message;
            
            if (!mediaMsg?.imageMessage && !mediaMsg?.videoMessage) {
                return await sendWithLogo(sock, jid, '❌ Reply to an image or video!');
            }
            
            try {
                const buffer = await downloadMediaMessage({ message: mediaMsg }, 'buffer', {});
                await sock.sendMessage(jid, { sticker: buffer });
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        toimg: async () => {
            const quoted = getQuotedMessage(msg);
            if (!quoted?.stickerMessage) return await sendWithLogo(sock, jid, '❌ Reply to a sticker!');
            
            try {
                const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {});
                await sock.sendMessage(jid, { image: buffer });
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        vv: async () => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const viewOnce = quoted?.viewOnceMessage || quoted?.viewOnceMessageV2;
            
            if (!viewOnce) return await sendWithLogo(sock, jid, '❌ Reply to a view-once message!');
            
            try {
                const media = viewOnce.message;
                const buffer = await downloadMediaMessage({ message: media }, 'buffer', {});
                
                if (media.imageMessage) {
                    await sock.sendMessage(jid, { image: buffer, caption: '👁️ View-once saved!' });
                } else if (media.videoMessage) {
                    await sock.sendMessage(jid, { video: buffer, caption: '👁️ View-once saved!' });
                }
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        // ========== SETTINGS ==========
        setprefix: async () => {
            const newPrefix = args[0];
            if (!newPrefix) return await sendWithLogo(sock, jid, '❌ Provide new prefix!');
            
            if (isGroupMsg) {
                groups[jid] = groups[jid] || {};
                groups[jid].prefix = newPrefix;
                saveData(dataFiles.groups, groups);
            } else {
                settings.prefix = newPrefix;
                saveData(dataFiles.settings, settings);
            }
            await sendWithLogo(sock, jid, `✅ Prefix changed to: ${newPrefix}`);
        },
        
        mode: async () => {
            const newMode = args[0]?.toLowerCase();
            if (!['private', 'groups', 'self'].includes(newMode)) {
                return await sendWithLogo(sock, jid, '❌ Use: private, groups, or self');
            }
            settings.mode = newMode;
            saveData(dataFiles.settings, settings);
            await sendWithLogo(sock, jid, `✅ Mode changed to: ${newMode}`);
        },
        
        setreply: async () => {
            const key = args[0]?.toLowerCase();
            const value = args.slice(1).join(' ');
            if (!key || !value) return await sendWithLogo(sock, jid, '❌ Use: setreply [key] [response]');
            quickReplies[key] = value;
            saveData(dataFiles.quickReplies, quickReplies);
            await sendWithLogo(sock, jid, `✅ Quick reply set! Say "${key}" to trigger.`);
        },
        
        backup: async () => {
            const backup = { settings, groups, users, quickReplies };
            const backupStr = JSON.stringify(backup, null, 2);
            await sock.sendMessage(jid, { document: Buffer.from(backupStr), mimetype: 'application/json', fileName: 'titan_backup.json' });
        },
        
        restore: async () => {
            const quoted = getQuotedMessage(msg);
            if (!quoted?.documentMessage) return await sendWithLogo(sock, jid, '❌ Reply to a backup file!');
            
            try {
                const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {});
                const data = JSON.parse(buffer.toString());
                if (data.settings) { settings = data.settings; saveData(dataFiles.settings, settings); }
                if (data.groups) { groups = data.groups; saveData(dataFiles.groups, groups); }
                if (data.users) { users = data.users; saveData(dataFiles.users, users); }
                if (data.quickReplies) { quickReplies = data.quickReplies; saveData(dataFiles.quickReplies, quickReplies); }
                await sendWithLogo(sock, jid, '✅ Backup restored!');
            } catch (e) { await sendWithLogo(sock, jid, '❌ Error: ' + e.message); }
        },
        
        // ========== PRESENCE ==========
        online: async () => {
            await sock.sendPresenceUpdate('available', jid);
            await sendWithLogo(sock, jid, '✅ Presence set to online!');
        },
        
        typing: async () => {
            await sock.sendPresenceUpdate('composing', jid);
            await sendWithLogo(sock, jid, '✅ Typing indicator shown!');
        },
        
        recording: async () => {
            await sock.sendPresenceUpdate('recording', jid);
            await sendWithLogo(sock, jid, '✅ Recording indicator shown!');
        },
        
        tagonline: async () => {
            if (!isGroupMsg) return;
            await sock.sendPresenceUpdate('available', jid);
            await sendWithLogo(sock, jid, '📢 Attempting to notify online users...\n(Note: Online detection is limited by WhatsApp privacy)');
        }
    };
    
    // Execute command
    if (commands[cmd]) {
        await commands[cmd]();
    }
}

// ==================== START BOT ====================
startTitan().catch(console.error);
