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
const { config, isOwner, isGroup, isChannel, getMessageText, getOwnerJid, settings, saveSettings, msgStore, spamTracker, gameStore, getCachedGroupMetadata, isViewOnceStub, getViewOnceInfo, isBotAdmin, getGroupSettings } = require('./utils');
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

// --- UNIVERSAL SESSION ID DECODER (PHASE 38/54) ---
if (process.env.SESSION_ID) {
    const credsPath = path.join(config.authPath, 'creds.json');
    let shouldDecode = false;

    if (!fs.existsSync(credsPath)) {
        shouldDecode = true;
    } else {
        try {
            const currentCreds = fs.readFileSync(credsPath, 'utf-8').trim();
            const sid = process.env.SESSION_ID.trim();
            let decoded;
            if (sid.startsWith('{')) {
                decoded = sid;
            } else {
                let cleanSid = sid;
                if (cleanSid.includes(':')) cleanSid = cleanSid.split(':')[1];
                if (cleanSid.includes('~')) cleanSid = cleanSid.split('~')[1];
                decoded = Buffer.from(cleanSid, 'base64').toString('utf-8');
            }
            if (currentCreds.replace(/\s/g, '') !== decoded.replace(/\s/g, '')) {
                console.log('[TITAN] SESSION_ID mismatch. Wiping...');
                shouldDecode = true;
            }
        } catch (e) {
            shouldDecode = true;
        }
    }

    if (shouldDecode) {
        try {
            let sid = process.env.SESSION_ID.trim();
            let decoded;
            if (sid.startsWith('{')) { decoded = sid; }
            else {
                if (sid.includes(':')) sid = sid.split(':')[1];
                if (sid.includes('~')) sid = sid.split('~')[1];
                decoded = Buffer.from(sid, 'base64').toString('utf-8');
            }
            JSON.parse(decoded);
            fs.removeSync(config.authPath);
            fs.ensureDirSync(config.authPath);
            fs.writeFileSync(credsPath, decoded);
            console.log('[TITAN] Session Clean Slate.');
        } catch (e) { }
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

// --- NUCLEAR HANDSHAKE RECOVERY (PHASE 53) ---
process.on('uncaughtException', (err) => {
    const isNoiseError = err.message.includes('Unsupported state') ||
        err.message.includes('unable to authenticate data') ||
        err.message.includes('Bad MAC');

    if (isNoiseError) {
        console.error('[TITAN RECOVERY] FATAL NOISE ERR: Purging corrupted session...');
        try {
            fs.emptyDirSync(config.authPath);
            console.log('[TITAN] Auth wiped. Please provide new SESSION_ID.');
        } catch (e) { }
        process.exit(1);
    } else {
        console.error('[TITAN] Uncaught Exception:', err);
    }
});

// Don't handle unhandledRejection aggressively - Bad MAC errors during message processing are non-fatal
// The bot will continue working even with these errors

// ============================================================
// GRACEFUL SHUTDOWN - Prevent 440 conflicts on restart/redeploy
// ============================================================

// Global socket reference for graceful logout
let currentSock = null;
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`[TITAN] Received ${signal}. Performing graceful logout...`);
    
    if (currentSock) {
        try {
            await currentSock.logout();
            console.log('[TITAN] Graceful logout successful. Old connection invalidated.');
        } catch (e) {
            console.log('[TITAN] Graceful logout error (can be ignored):', e.message);
        }
    }
    
    process.exit(0);
}

// Listen for shutdown signals (Render/Railway sends SIGTERM)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Main
// --- CONNECTION FLAGS (GLOBAL) ---
let connectionLock = false;
let reconnectAttempts = 0;
let isFirstConnection = true; // Global - only send SYSTEM ONLINE once
let lastDisconnectReason = null;
const MAX_RECONNECT_ATTEMPTS = 5;

// Exponential backoff: 30s, 60s, 120s, 240s, 480s
const getBackoffDelay = (attempt) => {
    const baseDelay = 30000; // 30 seconds
    const delay = baseDelay * Math.pow(2, attempt);
    console.log(`[TITAN] Exponential backoff: ${delay/1000}s for attempt ${attempt + 1}`);
    return delay;
};

async function startTitan() {
    console.log('[TITAN] Starting...');
    
    // On first start, wait 5 seconds to let any old instance die on WhatsApp's end
    if (reconnectAttempts === 0) {
        console.log('[TITAN] First connection attempt, waiting 5s for any old instance to die...');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(config.authPath);
    
    // Use stable Baileys version to reduce protocol detection
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[TITAN] Using Baileys version: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        // Browser fingerprint - Ubuntu Chrome works with all Baileys versions
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        linkPreview: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        // Custom reconnect logic - don't let Baileys auto-reconnect
        shouldRetry: (err) => {
            console.log('[TITAN] shouldRetry called:', err?.message);
            return false; // We handle reconnection manually
        },
        getMessage: async (key) => {
            if (msgStore) {
                const stored = msgStore.get(key.id);
                if (stored) return stored.msg;
            }
            return null;
        },
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage ||
                message.templateMessage ||
                message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadata: {},
                                deviceListMetadataVersion: 2
                            },
                            ...message
                        }
                    }
                };
            }
            return message;
        }
    });
    
    // Store socket reference for graceful shutdown
    currentSock = sock;

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
    const axios = require('axios'); // Move outside interval
    setInterval(async () => {
        const pingerUrl = settings.appUrl || process.env.RENDER_EXTERNAL_URL;
        if (pingerUrl) {
            try {
                await axios.get(pingerUrl).catch(() => null);
                console.log('[TITAN] Self-ping heartbeat');
            } catch (e) { }
        }
    }, 5 * 60 * 1000);

    sock.ev.on('creds.update', saveCreds);

    // ============================================================
    // GROUP PARTICIPANTS UPDATE - Welcome/Goodbye (PER-GROUP)
    // ============================================================
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id, participants, action } = update;
            console.log(`[TITAN] Group Event: ${id} | Action: ${action}`);

            // Get per-group settings
            const gs = getGroupSettings(id);
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            // WELCOME - New member added
            if (action === 'add' && gs.welcome?.enabled) {
                let groupName = 'Group';
                try {
                    const meta = await getCachedGroupMetadata(sock, id);
                    if (meta) {
                        groupName = meta.subject;
                    }
                } catch (e) { 
                    console.log('[TITAN] Welcome: Could not get group metadata:', e.message);
                }

                // Skip if bot was added
                if (participants.includes(botJid)) {
                    console.log('[TITAN] Welcome: Bot was added, skipping');
                    return;
                }

                for (const participant of participants) {
                    // Skip if participant is bot
                    if (participant.includes(botJid.split('@')[0])) continue;

                    // Process placeholders
                    let text = gs.welcome.text || 'Welcome @{user} to *{group}*! 👋';
                    text = text
                        .replace(/{user}/g, participant.split('@')[0])
                        .replace(/{group}/g, groupName)
                        .replace(/{time}/g, new Date().toLocaleString());

                    try {
                        const ppUrl = await sock.profilePictureUrl(participant, 'image').catch(() => null);
                        if (ppUrl) {
                            await sock.sendMessage(id, { image: { url: ppUrl }, caption: text, mentions: [participant] });
                        } else {
                            await sock.sendMessage(id, { text, mentions: [participant] });
                        }
                        console.log(`[TITAN] Welcome sent to @${participant.split('@')[0]}`);
                    } catch (e) {
                        console.error('[TITAN] Welcome send error:', e.message);
                    }
                }
            }

            // GOODBYE - Member removed
            if (action === 'remove' && gs.goodbye?.enabled) {
                // Skip if bot was removed
                if (participants.includes(botJid)) {
                    console.log('[TITAN] Goodbye: Bot was removed');
                    return;
                }

                for (const participant of participants) {
                    if (participant.includes(botJid.split('@')[0])) continue;

                    // Process placeholders
                    let text = gs.goodbye.text || 'Goodbye @{user} 👋';
                    text = text
                        .replace(/{user}/g, participant.split('@')[0])
                        .replace(/{group}/g, 'Group')
                        .replace(/{time}/g, new Date().toLocaleString());

                    try {
                        await sock.sendMessage(id, { text, mentions: [participant] });
                        console.log(`[TITAN] Goodbye sent to @${participant.split('@')[0]}`);
                    } catch (e) {
                        console.error('[TITAN] Goodbye send error:', e.message);
                    }
                }
            }

        } catch (e) {
            console.error('[TITAN] Group Update Error:', e);
        }
    });

    // Anti-Delete Listener 
    sock.ev.on('messages.update', async (updates) => {
        if (!settings.antidelete) return;
        for (const update of updates) {
            if (update.update.message && update.update.message.protocolMessage && update.update.message.protocolMessage.type === 0) {
                const key = update.key;
                const jid = key.remoteJid;
                const messageId = update.update.message.protocolMessage.key.id;

                const deletedMsg = msgStore.get(messageId);
                if (deletedMsg) {
                    const { msg, sender } = deletedMsg;
                    const caption = `🗑️ *Anti-Delete Detected*\nSender: @${sender.split('@')[0]}\nRecovered Content:`;
                    const text = getMessageText({ message: msg });
                    if (text) {
                        await sock.sendMessage(jid, { text: `${caption}\n\n${text}`, mentions: [sender] });
                    } else {
                        const forwardJid = isGroup(jid) ? jid : sender;
                        await sock.sendMessage(forwardJid, { forward: { key: { remoteJid: forwardJid, id: messageId }, message: msg }, caption: caption, mentions: [sender] });
                    }
                }
            }
        }
    });

    // Connection Logic
    let pulseInterval;
    const startTime = Date.now();
    const startPulse = () => {
        if (pulseInterval) clearInterval(pulseInterval);
        pulseInterval = setInterval(async () => {
            if (settings.pulse && sock.user) {
                const uptime = moment.duration(Date.now() - startTime).humanize();
                const status = `TITAN AI Active 🛡️ | Uptime: ${uptime} | Prefix: ${config.prefix}`;
                try {
                    await sock.updateProfileStatus(status);
                } catch (e) { }
            }
        }, 60 * 60 * 1000);
    };

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            // Only send welcome message on FIRST connection, not on reconnect
            if (connectionLock) return; // Prevent multiple notifications
            connectionLock = true;
            
            // Reset reconnect attempts on successful connection
            if (reconnectAttempts > 0) {
                console.log(`[TITAN] Connection restored after ${reconnectAttempts} reconnection attempts`);
            }
            reconnectAttempts = 0;

            console.log('[TITAN] ✅ Connected successfully!');
            startPulse();

            // Only send "SYSTEM ONLINE" on first connect after bot starts
            if (isFirstConnection) {
                isFirstConnection = false;
                await sock.sendMessage(getOwnerJid(), { text: '⚡ *TITAN SYSTEM ONLINE*\n\nGlobal Shields Active. Stability level: CRITICAL_MAX.' });
            } else {
                console.log('[TITAN] Reconnected (skipping notification)');
            }

            // --- SESSION EXPORTER ---
            if (!process.env.SESSION_ID) {
                try {
                    const credsFile = path.join(config.authPath, 'creds.json');
                    if (fs.existsSync(credsFile)) {
                        const creds = fs.readFileSync(credsFile, 'utf-8');
                        const sessionString = Buffer.from(creds).toString('base64');
                        await sock.sendMessage(getOwnerJid(), { text: `⚠️ *SESSION BACKUP*\n\nSESSION_ID:\n\n${sessionString}` });
                    }
                } catch (e) { }
            }

            // --- AUTO-JOIN ---
            try {
                const groupCode = settings.supportGroup || config.supportGroup;
                if (groupCode) await sock.groupAcceptInvite(groupCode);
            } catch (e) { }
        }

        if (connection === 'close') {
            connectionLock = false;
            const reason = lastDisconnect?.error?.output?.statusCode;
            const msg = lastDisconnect?.error?.message || 'Unknown reason';
            
            console.log(`[TITAN] Connection closed: ${msg} (Code: ${reason})`);

            // --- SESSION RECOVERY (SELF-HEAL) ---
            const isUnauthorized = reason === DisconnectReason.loggedOut || reason === 401;
            const isConflict = reason === DisconnectReason.connectionClosed || reason === 428 || reason === 440;
            const isRestartRequired = reason === DisconnectReason.restartRequired || reason === 515;
            
            // 401/403 - Session expired/invalid - DELETE auth and restart fresh
            if (isUnauthorized || reason === 403) {
                console.error('[TITAN] SESSION EXPIRED/INVALID: Deleting credentials...');
                fs.emptyDirSync(config.authPath);
                console.log('[TITAN] Auth wiped. Please provide new SESSION_ID or re-pair.');
                process.exit(1);
            }
            
            // 440 Conflict - Old instance still connected - Exponential backoff
            if (isConflict) {
                reconnectAttempts++;
                
                if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log('[TITAN] Max reconnect attempts reached. Wiping session...');
                    fs.emptyDirSync(config.authPath);
                    reconnectAttempts = 0;
                    console.log('[TITAN] Session wiped. Restarting with fresh session...');
                    setTimeout(() => startTitan(), 5000);
                    return;
                }
                
                // Exponential backoff: 30s, 60s, 120s, 240s, 480s
                const delay = getBackoffDelay(reconnectAttempts - 1);
                console.log(`[TITAN] 440 Conflict: Waiting ${delay/1000}s before retry (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                console.log('[TITAN] Tip: Wait longer between redeploys, or ensure old instance is fully stopped');
                
                setTimeout(() => startTitan(), delay);
                return;
            }
            
            // 515 - Restart required - Immediate reconnect
            if (isRestartRequired) {
                console.log('[TITAN] Restart required (515). Reconnecting immediately...');
                setTimeout(() => startTitan(), 2000);
                return;
            }

            // Other errors - Normal reconnect with backoff
            reconnectAttempts++;
            const delay = reconnectAttempts <= MAX_RECONNECT_ATTEMPTS ? getBackoffDelay(reconnectAttempts - 1) : 60000;
            console.log(`[TITAN] Connection error. Reconnecting in ${delay/1000}s...`);
            setTimeout(() => startTitan(), delay);
        }
    });

    // Anti-Call System
    sock.ev.on('call', async (calls) => {
        if (!settings.anticall) return;
        for (const call of calls) {
            if (call.status === 'offer') {
                console.log(`[TITAN SHIELD] Rejecting call from: ${call.from}`);
                await sock.rejectCall(call.id, call.from);

                const ownerJid = getOwnerJid();
                const refusalMsg = `🛡️ *TITAN IRON SHIELD*\n\nSorry, my owner @${ownerJid.split('@')[0]} is currently busy. Calls are not allowed.\n\n_Please send a text message instead._`;
                await sock.sendMessage(call.from, { text: refusalMsg, mentions: [ownerJid] });

                await sock.sendMessage(ownerJid, {
                    text: `🚨 *IRON SHIELD ALERT*\n\nBlocked a call from: @${call.from.split('@')[0]}`,
                    mentions: [call.from]
                });
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                const jid = msg.key.remoteJid;
                const fromMe = msg.key.fromMe;
                
                if (jid === 'status@broadcast' && settings.ghost) {
                    sock.readMessages([msg.key]).catch(() => { });
                    console.log(`[TITAN GHOST] Status viewed from: ${msg.pushName || 'Someone'}`);
                    continue;
                }

                // --- AUTO ANTI-VIEWONCE (PHASE ANTI-VV) ---
                // Must check BEFORE storing message - view-once media only available before viewing!
                if (settings.antivviewonce && !fromMe) {
                    const voInfo = getViewOnceInfo(msg);
                    if (voInfo) {
                        console.log(`[TITAN ANTI-VV] View once detected! Type: ${voInfo.type} from @${voInfo.sender.split('@')[0]}`);
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            const caption = `🕵️ *ANTI-VIEWONCE CATCH*\n\n👤 From: @${voInfo.sender.split('@')[0]}\n💬 Chat: ${voInfo.jid}\n⏰ Time: ${new Date(voInfo.timestamp * 1000).toLocaleString()}\n📎 Type: ${voInfo.type.toUpperCase()}`;
                            
                            if (voInfo.type === 'image') {
                                await sock.sendMessage(getOwnerJid(), { image: buffer, caption, mentions: [voInfo.sender] });
                            } else if (voInfo.type === 'video') {
                                await sock.sendMessage(getOwnerJid(), { video: buffer, caption, mentions: [voInfo.sender] });
                            } else if (voInfo.type === 'audio') {
                                await sock.sendMessage(getOwnerJid(), { audio: buffer, caption: caption.replace(voInfo.type.toUpperCase(), 'AUDIO 🎤'), mentions: [voInfo.sender] });
                            }
                            console.log(`[TITAN ANTI-VV] Forwarded to owner successfully`);
                        } catch (vvErr) {
                            console.error('[TITAN ANTI-VV] Failed to capture:', vvErr.message);
                        }
                    }
                }

                if (!msg.message) continue;

                const sender = fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || jid);
                const text = getMessageText(msg).trim();

                // Store messages for Anti-Delete (All incoming)
                if (!fromMe) {
                    msgStore.set(msg.key.id, { msg: msg.message, sender, timestamp: Date.now() });
                }

                console.log(`[TITAN] ${jid.split('@')[0]} | @${sender.split('@')[0]}: ${text || '(media)'}`);

                // --- AUTO OWNER DETECTION ---
                if (!settings.ownerJid && !config.ownerNumber && sender && !fromMe) {
                    settings.ownerJid = sender;
                    saveSettings();
                    sock.sendMessage(jid, { text: `🎉 *TITAN CONNECTED!*\n\nYou have been auto-detected as the **OWNER**. \n\nCommands are now locked to you. Type *${config.prefix}menu* to begin!` }).catch(() => { });
                }

                if (isGroup(jid)) {
                    if (await handleAntiLink(sock, msg, jid, text, sender)) continue;
                }

                // --- MODE CONTROL (PHASE 14) ---
                const mode = settings.mode || 'private';
                const owner = isOwner(sender);
                const isGroupChat = isGroup(jid);
                const isChannelChat = isChannel(jid);

                let allowed = owner;
                if (!allowed) {
                    if (mode === 'public') allowed = true;
                    else if (mode === 'group' && isGroupChat) allowed = true;
                    else if (mode === 'public' && isChannelChat) allowed = true;
                }

                if (!allowed) continue;

                // --- ANTI-SPAM ---
                if (isGroup(jid) && settings.antispam && !fromMe) {
                    const now = Date.now();
                    const userSpam = spamTracker.get(`${jid}_${sender}`) || { count: 0, lastMsg: 0, warned: false };
                    if (now - userSpam.lastMsg < 10000) { userSpam.count++; } else { userSpam.count = 1; userSpam.warned = false; }
                    userSpam.lastMsg = now;
                    spamTracker.set(`${jid}_${sender}`, userSpam);

                    if (userSpam.count >= 6) {
                        if (!userSpam.warned) {
                            await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]}, stop spamming!`, mentions: [sender] });
                            userSpam.warned = true;
                        } else if (userSpam.count >= 10) {
                            try {
                                const meta = await getCachedGroupMetadata(sock, jid);
                                const admins = getGroupAdmins(meta.participants);
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
                const cmdStart = Date.now();

                // --- NUCLEAR SPEED: NON-BLOCKING EXECUTION ---
                try {
                    sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => { });
                    sock.sendPresenceUpdate('composing', jid).catch(() => { });

                    // Fire and forget (Command internally handles its own flow)
                    handleCommand(sock, msg, jid, sender, cmd, args, text, owner, cmdStart).catch(cmdErr => {
                        console.error('[TITAN LIGHTNING ERR]', cmdErr);
                        sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => { });
                    });

                    sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => { });
                    sock.sendPresenceUpdate('paused', jid).catch(() => { });
                } catch (err) {
                    console.error('[TITAN DISPATCH ERR]', err);
                }

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
