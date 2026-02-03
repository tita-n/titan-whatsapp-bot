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
const { config, isOwner, isGroup, isChannel, getMessageText, getOwnerJid, settings, saveSettings, msgStore, spamTracker, gameStore, getCachedGroupMetadata } = require('./utils');
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

// --- UNIVERSAL SESSION ID DECODER (PHASE 38) ---
if (process.env.SESSION_ID) {
    const credsPath = path.join(config.authPath, 'creds.json');
    let shouldDecode = false;

    if (!fs.existsSync(credsPath)) {
        shouldDecode = true;
    } else {
        // Check if the current SESSION_ID is different from what we have
        try {
            const currentCreds = fs.readFileSync(credsPath, 'utf-8');
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

            // If the JSON content doesn't match exactly, we must re-decode
            if (currentCreds !== decoded) {
                console.log('[TITAN] SESSION_ID change detected. Wiping auth folder...');
                shouldDecode = true;
            }
        } catch (e) {
            shouldDecode = true;
        }
    }

    if (shouldDecode) {
        console.log('[TITAN] Initializing Universal Session...');
        try {
            let sid = process.env.SESSION_ID.trim();
            let decoded;

            if (sid.startsWith('{')) {
                decoded = sid;
            } else {
                if (sid.includes(':')) sid = sid.split(':')[1];
                if (sid.includes('~')) sid = sid.split('~')[1];
                decoded = Buffer.from(sid, 'base64').toString('utf-8');
            }

            // Validation
            JSON.parse(decoded);

            // Clean slate: Wipe the entire auth folder including keys/ sessions
            fs.removeSync(config.authPath);
            fs.ensureDirSync(config.authPath);

            fs.writeFileSync(credsPath, decoded);
            console.log('[TITAN] Session restored successfully with a clean slate.');
        } catch (e) {
            console.error('[TITAN] Failed to decode Session ID. Check format.');
        }
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
// --- CONNECTION FLAGS (GLOBAL) ---
let connectionLock = false;

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
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        syncFullHistory: false,
        linkPreview: false,
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
                console.log('[TITAN] Self-ping success:', pingerUrl);
            } catch (e) { }
        }
    }, 5 * 60 * 1000);

    sock.ev.on('creds.update', saveCreds);

    // Group Participants Update (Welcome/Goodbye)
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id, participants, action } = update;
            console.log(`[TITAN] Group Event: ${id} | Action: ${action}`);

            if (action === 'add' && settings.welcome) {
                let groupName = 'Group';
                try {
                    const meta = await getCachedGroupMetadata(sock, id);
                    if (meta) {
                        groupName = meta.subject;
                        if (participants.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net')) return;
                    }
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

            if (action === 'remove' && settings.goodbye) {
                for (const participant of participants) {
                    if (participant.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net')) return;
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
            if (connectionLock) return; // Prevent multiple notifications/syncs
            connectionLock = true;

            console.log('[TITAN] ✅ Connected successfully!');
            startPulse();

            await sock.sendMessage(getOwnerJid(), { text: '⚡ *TITAN SYSTEM ONLINE*\n\nGlobal Shields Active. Stability level: CRITICAL_MAX.' });

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

            console.log(`[TITAN] Connection closed: ${msg} (${reason})`);

            // Handle Specific Fatal Reasons
            const isUnauthorized = reason === DisconnectReason.loggedOut || reason === 401;
            const isConflict = reason === DisconnectReason.connectionClosed || reason === 428 || reason === 440;

            if (isUnauthorized) {
                console.error('[TITAN] SESSION EXPIRED: Deleting credentials...');
                fs.emptyDirSync(config.authPath);
                console.log('[TITAN] Please re-pair using the session generator or pairing code.');
                // Don't auto-restart infinitely on 401
                process.exit(1);
            } else if (isConflict) {
                console.log('[TITAN] Conflict/Stream error. Waiting 15s for old instance to die...');
                setTimeout(() => startTitan(), 15000);
            } else {
                console.log('[TITAN] Restarting script in 5s...');
                setTimeout(() => startTitan(), 5000);
            }
        }
    });

    // Message Handler
    // --- ANTI-CALL SYSTEM (PHASE 40) ---
    sock.ev.on('call', async (calls) => {
        if (!settings.anticall) return;
        for (const call of calls) {
            if (call.status === 'offer') {
                console.log(`[TITAN SHIELD] Rejecting call from: ${call.from}`);
                await sock.rejectCall(call.id, call.from);

                // Notify Caller
                const ownerJid = getOwnerJid();
                const refusalMsg = `🛡️ *TITAN IRON SHIELD*\n\nSorry, my owner @${ownerJid.split('@')[0]} is currently busy. Calls are not allowed at the moment.\n\n_Please send a text message instead._`;
                await sock.sendMessage(call.from, { text: refusalMsg, mentions: [ownerJid] });

                // Notify Owner
                await sock.sendMessage(ownerJid, {
                    text: `🚨 *IRON SHIELD ALERT*\n\nBlocked an incoming call from: @${call.from.split('@')[0]}`,
                    mentions: [call.from]
                });
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                // --- GHOST MODE: AUTO-STATUS VIEW (PHASE 41) ---
                const jid = msg.key.remoteJid;
                if (jid === 'status@broadcast' && settings.ghost) {
                    await sock.readMessages([msg.key]);
                    console.log(`[TITAN GHOST] Status viewed from: ${msg.pushName || 'Someone'}`);
                    continue; // Skip further processing for status messages
                }

                if (!msg.message) continue;

                const fromMe = msg.key.fromMe;
                const sender = fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || jid);
                const text = getMessageText(msg).trim();

                // Store messages for Anti-Delete (All incoming)
                if (!fromMe) {
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
                if (settings.antiviewonce) {
                    const viewOnceMsg = msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 ||
                        msg.message.viewOnceMessageV2Extension || msg.message.ephemeralMessage?.message?.viewOnceMessageV2;
                    if (viewOnceMsg) {
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            const content = viewOnceMsg.message || viewOnceMsg;
                            const mediaType = Object.keys(content).find(k => k.endsWith('Message'));
                            const caption = `🕵️ *Anti-ViewOnce Spy*\nSource: ${jid}\nSender: @${sender.split('@')[0]}`;
                            if (mediaType.includes('image')) {
                                await sock.sendMessage(getOwnerJid(), { image: buffer, caption, mentions: [sender] });
                            } else if (mediaType.includes('video')) {
                                await sock.sendMessage(getOwnerJid(), { video: buffer, caption, mentions: [sender] });
                            }
                        } catch (e) { console.error('[TITAN VV SPY] Error:', e.message); }
                    }
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

                // --- PHASE 43: LIGHTNING OPTIMIZATION ---
                try {
                    // 1. Non-blocking Micro-UX
                    sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(e => console.error('[TITAN REACT ERR]', e));
                    sock.sendPresenceUpdate('composing', jid).catch(e => console.error('[TITAN PRESENCE ERR]', e));

                    // 2. Immediate Execution (Passing cmdStart)
                    await handleCommand(sock, msg, jid, sender, cmd, args, text, owner, cmdStart);

                    // 3. Success React (Non-blocking)
                    sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(e => console.error('[TITAN REACT ERR]', e));
                    sock.sendPresenceUpdate('paused', jid).catch(e => console.error('[TITAN PRESENCE ERR]', e));

                } catch (cmdErr) {
                    console.error('[TITAN L-SPEED ERR]', cmdErr);
                    sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => { });
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
