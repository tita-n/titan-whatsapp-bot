/**
 * TITAN WhatsApp Bot - Main Entry Point
 * Modularized & Optimized
 */

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs-extra');
const pino = require('pino');
const path = require('path');

// Modules
const { config, isOwner, isGroup, getMessageText, getOwnerJid, settings, saveSettings, msgStore, spamTracker, gameStore, getCachedGroupMetadata } = require('./utils');
const cron = require('node-cron');

// --- DYNAMIC COMMAND LOADER (PHASE 17) ---
let { handleCommand, handleAntiLink } = require('./commands');

/**
 * Hot-reloads the commands module without restarting the bot
 */
function reloadCommands() {
    try {
        delete require.cache[require.resolve('./commands')];
        const newCmds = require('./commands');
        handleCommand = newCmds.handleCommand;
        handleAntiLink = newCmds.handleAntiLink;
        console.log('[TITAN] Commands HOT-RELOADED 🚀');
        return true;
    } catch (e) {
        console.error('[TITAN] Reload Error:', e);
        return false;
    }
}

// Ensure dirs
fs.ensureDirSync(config.authPath);
fs.ensureDirSync(config.dataPath);
fs.ensureDirSync(config.downloadPath);

// --- UNIVERSAL SESSION ID DECODER (PHASE 37) ---
if (process.env.SESSION_ID && !fs.existsSync(path.join(config.authPath, 'creds.json'))) {
    console.log('[TITAN] Decoding Session ID...');
    try {
        let sid = process.env.SESSION_ID.trim();
        let decoded;

        if (sid.startsWith('{')) {
            // Raw JSON Session Support
            decoded = sid;
            console.log('[TITAN] Raw JSON Session detected.');
        } else {
            // Base64 Encoded (TITAN standard or prefixed)
            if (sid.includes(':')) sid = sid.split(':')[1];
            if (sid.includes('~')) sid = sid.split('~')[1];
            decoded = Buffer.from(sid, 'base64').toString('utf-8');
        }

        // Validation: Must be valid JSON
        JSON.parse(decoded);

        fs.writeFileSync(path.join(config.authPath, 'creds.json'), decoded);
        console.log('[TITAN] Universal Session restored successfully.');
    } catch (e) {
        console.error('[TITAN] Invalid or Incompatible Session ID provided.');
    }
}

const app = express();
app.get('/', (req, res) => res.send('TITAN BOT IS ACTIVE 🚀'));

const server = app.listen(config.port, '0.0.0.0', () => console.log(`[TITAN] Server on ${config.port}`));
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[TITAN] Port ${config.port} is already in use.`);
        process.exit(1);
    }
});

// Main
async function startTitan() {
    console.log('[TITAN] Starting...');
    const { state, saveCreds } = await useMultiFileAuthState(config.authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.0"],
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 20000,
        syncFullHistory: false
    });

    // --- KEEP ALIVE PING ---
    const keepAlive = setInterval(async () => {
        if (sock.user) {
            try {
                await sock.sendPresenceUpdate('available');
            } catch (e) { }
        }
    }, 25000);

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'close') clearInterval(keepAlive);
    });

    // --- SELF PINGER (FOR RENDER 24/7) ---
    setInterval(async () => {
        const pingerUrl = settings.appUrl || process.env.RENDER_EXTERNAL_URL;
        if (pingerUrl) {
            try {
                const axios = require('axios');
                await axios.get(pingerUrl).catch(() => null);
                console.log('[TITAN] Self-ping successful:', pingerUrl);
            } catch (e) { }
        }
    }, 5 * 60 * 1000); // 5 minutes

    // --- MEMORY CLEANUP (AUTO-WIPE DOWNLOADS) ---
    setInterval(() => {
        const fs = require('fs-extra');
        try {
            fs.emptyDirSync(config.downloadPath);
            console.log('[TITAN] Download cache cleared.');
        } catch (e) { }
    }, 60 * 60 * 1000); // Hourly


    sock.ev.on('creds.update', saveCreds);

    // Group Participants Update (Welcome/Goodbye)
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id, participants, action } = update;
            console.log(`[TITAN] Group Event: ${id} | Action: ${action}`);

            if (action === 'add' && settings.welcome[id]) {
                let groupName = 'Group';
                try {
                    const meta = await getCachedGroupMetadata(sock, id);
                    if (meta) groupName = meta.subject;
                } catch (e) { }

                for (const participant of participants) {
                    const text = `Welcome @${participant.split('@')[0]} to *${groupName}*! 👋\nRead the description to stay safe.`;
                    const ppUrl = await sock.profilePictureUrl(participant, 'image').catch(() => null);

                    if (ppUrl) {
                        await sock.sendMessage(id, { image: { url: ppUrl }, caption: text, mentions: [participant] });
                    } else {
                        await sock.sendMessage(id, { text, mentions: [participant] });
                    }
                }
            }

            if (action === 'remove' && settings.goodbye[id]) {
                for (const participant of participants) {
                    const text = `Goodbye @${participant.split('@')[0]} 👋`;
                    await sock.sendMessage(id, { text, mentions: [participant] });
                }
            }

        } catch (e) {
            console.error('[TITAN] Group Update Error:', e);
        }
    });

    // Anti-Delete Listener 
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update.message && update.update.message.protocolMessage && update.update.message.protocolMessage.type === 0) {
                const key = update.key;
                const jid = key.remoteJid;

                if (settings.antidelete[jid]) {
                    const deletedMsg = msgStore.get(key.id);
                    if (deletedMsg) {
                        const { msg, sender } = deletedMsg;
                        const caption = `🗑️ *Anti-Delete Detected*\nSender: @${sender.split('@')[0]}\nRecovered Content:`;
                        const text = getMessageText({ message: msg });
                        if (text) {
                            await sock.sendMessage(jid, { text: `${caption}\n\n${text}`, mentions: [sender] });
                        } else {
                            await sock.sendMessage(jid, { forward: { key: { remoteJid: jid, id: key.id }, message: msg }, caption: caption, mentions: [sender] });
                        }
                    }
                }
            }
        }
    });

    // Connection Logic (FIXED BRACES)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'open') {
            console.log('[TITAN] ✅ Connected!');
            await sock.sendMessage(getOwnerJid(), { text: '[TITAN] System Online ⚡' });

            // --- SESSION EXPORTER (Z-UX PHASE) ---
            if (!process.env.SESSION_ID) {
                try {
                    const credsFile = path.join(config.authPath, 'creds.json');
                    if (fs.existsSync(credsFile)) {
                        const creds = fs.readFileSync(credsFile, 'utf-8');
                        const sessionString = Buffer.from(creds).toString('base64');

                        // Message 1: Instruction
                        await sock.sendMessage(getOwnerJid(), { text: `⚠️ *SAVE YOUR BOT'S MEMORY* ⚠️\n\nTo make me stay online 24/7 without needing to link again, follow these 2 steps:\n\n1. *Copy* the long code in the next message.\n2. Go to your Railway Settings -> *Variables*, click 'Add', type *SESSION_ID* as the name, and paste the code.\n\n_This prevents the bot from logging out!_` });

                        // Message 2: The Key Alone (Easy to copy)
                        await sock.sendMessage(getOwnerJid(), { text: sessionString });
                    }
                } catch (e) { console.error('[TITAN] Exporter Error:', e); }
            }

            // --- AUTO-JOIN ---
            try {
                const groupCode = settings.supportGroup || config.supportGroup;
                if (groupCode) await sock.groupAcceptInvite(groupCode);
            } catch (e) { }

            try {
                const channelId = settings.supportChannel || config.supportChannel;
                if (channelId && sock.newsletterFollow) await sock.newsletterFollow(channelId);
            } catch (e) { }
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[TITAN] Connection closed. Reason: ${reason}`);
            const shouldReconnect = reason !== DisconnectReason.loggedOut && reason !== 401 && reason !== 405;

            if (shouldReconnect) {
                console.log('[TITAN] Reconnecting in 5s...');
                setTimeout(() => startTitan(), 5000);
            } else {
                if (reason === 401 || reason === 405) {
                    fs.emptyDirSync(config.authPath);
                    setTimeout(() => startTitan(), 2000);
                } else {
                    console.log('[TITAN] Session terminated. Manual intervention required.');
                    process.exit(1);
                }
            }
        }
    });

    // Message Handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (!msg.message) continue;

                const jid = msg.key.remoteJid;
                const fromMe = msg.key.fromMe;
                const sender = fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || jid);
                const text = getMessageText(msg).trim();

                if (jid.endsWith('@g.us') && !fromMe) {
                    msgStore.set(msg.key.id, { msg: msg.message, sender, timestamp: Date.now() });
                }

                console.log(`[TITAN] ${jid.split('@')[0]} | @${sender.split('@')[0]}: ${text || '(media)'}`);

                // --- AUTO OWNER DETECTION (PHASE 15) ---
                if (!settings.ownerJid && !config.ownerNumber && sender && !fromMe) {
                    settings.ownerJid = sender;
                    await saveSettings();
                    await sock.sendMessage(jid, { text: `🎉 *TITAN CONNECTED!*\n\nYou have been auto-detected as the **OWNER**. \n\nCommands are now locked to you. Type *${config.prefix}menu* to begin!` }, { quoted: msg });
                }

                // --- PASSIVE ANTI-VIEWONCE ---
                if (isGroup(jid) && settings.antiviewonce[jid]) {
                    const viewOnceMsg = msg.message.viewOnceMessage || msg.message.viewOnceMessageV2;
                    if (viewOnceMsg) {
                        try {
                            const buffer = await downloadMediaMessage({ message: viewOnceMsg }, 'buffer', {});
                            const content = viewOnceMsg.message;
                            const mediaType = Object.keys(content).find(k => k.endsWith('Message'));
                            const caption = `🕵️ *Anti-ViewOnce Spy*\nGroup: ${jid}\nSender: @${sender.split('@')[0]}`;
                            if (mediaType.includes('image')) {
                                await sock.sendMessage(getOwnerJid(), { image: buffer, caption, mentions: [sender] });
                            } else if (mediaType.includes('video')) {
                                await sock.sendMessage(getOwnerJid(), { video: buffer, caption, mentions: [sender] });
                            }
                        } catch (e) { }
                    }
                }

                if (isGroup(jid)) {
                    if (await handleAntiLink(sock, msg, jid, text, sender)) continue;
                }

                // --- MODE CONTROL (PHASE 14) ---
                const mode = settings.mode || 'private';
                const owner = isOwner(sender);
                const isGroupChat = isGroup(jid);

                // Logic: 
                // 1. Owner ALWAYS allowed.
                // 2. Private: Only owner allowed.
                // 3. Group: Allowed if in group. (In PM, only owner).
                // 4. Public: Allowed everywhere.
                let allowed = owner;
                if (!allowed) {
                    if (mode === 'public') allowed = true;
                    else if (mode === 'group' && isGroupChat) allowed = true;
                }

                if (!allowed) continue;

                // --- ANTI-SPAM ---
                if (isGroup(jid) && settings.antispam && settings.antispam[jid] && !fromMe) {
                    const now = Date.now();
                    const userSpam = spamTracker.get(`${jid}_${sender}`) || { count: 0, lastMsg: 0, warned: false };
                    if (now - userSpam.lastMsg < 10000) { userSpam.count++; } else { userSpam.count = 1; userSpam.warned = false; }
                    userSpam.lastMsg = now;
                    spamTracker.set(`${jid}_${sender}`, userSpam);

                    if (userSpam.count >= 5) {
                        if (!userSpam.warned) {
                            await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]}, stop spamming!`, mentions: [sender] });
                            userSpam.warned = true;
                            spamTracker.set(`${jid}_${sender}`, userSpam);
                        } else if (userSpam.count >= 8) {
                            try {
                                const meta = await getCachedGroupMetadata(sock, jid);
                                const admins = meta.participants.filter(p => p.admin).map(p => p.id);
                                const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                                if (admins.includes(botId) && !admins.includes(sender)) {
                                    await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} removed for spamming.`, mentions: [sender] });
                                    await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                                }
                            } catch (e) { }
                            continue;
                        }
                    }
                }

                // --- GAME INPUT ---
                const game = gameStore.get(jid);
                if (game && game.status === 'active' && !text.startsWith(config.prefix)) {
                    await handleCommand(sock, msg, jid, sender, `_game_input_`, [], text, owner);
                    continue;
                }

                if (!text.startsWith(config.prefix)) continue;

                const args = text.slice(config.prefix.length).trim().split(/\s+/);
                const cmd = args.shift().toLowerCase();
                await handleCommand(sock, msg, jid, sender, cmd, args, text, owner);

            } catch (e) {
                console.error('[TITAN] Handler Error:', e);
            }
        }
    });

    // --- REMINDER SCHEDULER (PHASE 19) ---
    cron.schedule('* * * * *', async () => {
        const now = Date.now();
        const due = settings.reminders.filter(r => r.time <= now);
        if (due.length > 0) {
            for (const r of due) {
                try {
                    await sock.sendMessage(r.jid, { text: `⏰ *TITAN REMINDER*\n\nHey @${r.sender.split('@')[0]}, you asked me to remind you about:\n\n"*${r.task}*"`, mentions: [r.sender] });
                } catch (e) { }
            }
            settings.reminders = settings.reminders.filter(r => r.time > now);
            await saveSettings();
        }
    });
}

module.exports = { startTitan, reloadCommands };

startTitan();
