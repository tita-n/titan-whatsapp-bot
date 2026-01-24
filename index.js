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
const { config, isOwner, isGroup, getMessageText, getOwnerJid, settings, msgStore, spamTracker, gameStore, getCachedGroupMetadata } = require('./utils');
const { handleCommand, handleAntiLink } = require('./commands');

// Ensure dirs
fs.ensureDirSync(config.authPath);
fs.ensureDirSync(config.dataPath);
fs.ensureDirSync(config.downloadPath);

// --- SESSION ID DECODER ---
if (process.env.SESSION_ID && !fs.existsSync(path.join(config.authPath, 'creds.json'))) {
    console.log('[TITAN] Decoding Session ID...');
    try {
        const decoded = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        fs.writeFileSync(path.join(config.authPath, 'creds.json'), decoded);
        console.log('[TITAN] Session restored from Env Var.');
    } catch (e) {
        console.error('[TITAN] Invalid Session ID in Env Var.');
    }
}

let pairingCode = ''; // For web display
let isPairingRequested = false; // Flag to prevent multiple requests

// Express (Health Check / Pairing Code)
const app = express();
app.get('/', (r, s) => s.send('TITAN Alive'));
app.get('/pair', (r, s) => {
    if (r.query.reset === 'true') {
        isPairingRequested = false;
        pairingCode = '';
        return s.send('<h1>TITAN Pairing Reset</h1><p>Requesting new code... Refresh in a few seconds.</p>');
    }
    if (pairingCode) {
        s.send(`<h1>TITAN Pairing Code</h1><p style="font-size: 2em; font-weight: bold; color: #25D366;">${pairingCode}</p><p>Enter this in your WhatsApp Link Device screen.</p><hr><a href="/pair?reset=true">Get New Code</a>`);
    } else {
        s.send('<h1>TITAN</h1><p>No active pairing request or already paired.</p>');
    }
});

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
        browser: Browsers.macOS('safari'),
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

            if (action === 'add' && settings.welcome[id]) {
                let groupName = 'Group';
                try {
                    const meta = await getCachedGroupMetadata(sock, id);
                    groupName = meta.subject;
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

        if (qr && !sock.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true;
            console.log(`[TITAN] Pairing required for number: ${config.ownerNumber}`);
            try {
                await new Promise(r => setTimeout(r, 2000));
                pairingCode = await sock.requestPairingCode(config.ownerNumber);
                console.log(`PAIRING CODE: ${pairingCode}`);
            } catch (e) {
                console.error('[TITAN] Pairing Request Error:', e);
                isPairingRequested = false;
            }
        }

        if (connection === 'open') {
            pairingCode = '';
            isPairingRequested = false;
            console.log('[TITAN] ✅ Connected!');
            await sock.sendMessage(getOwnerJid(), { text: '[TITAN] System Online ⚡' });

            // --- SESSION EXPORTER ---
            if (!process.env.SESSION_ID) {
                try {
                    const credsFile = path.join(config.authPath, 'creds.json');
                    if (fs.existsSync(credsFile)) {
                        const creds = fs.readFileSync(credsFile, 'utf-8');
                        const sessionString = Buffer.from(creds).toString('base64');
                        await sock.sendMessage(getOwnerJid(), { text: `🔑 *TITAN SESSION ID*\n\nCopy the text below and add it to your Render Environment Variables as *SESSION_ID* to keep the bot alive forever!\n\n\`\`\`${sessionString}\`\`\`` });
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
                console.log('[TITAN] Session terminated. Manual intervention required.');
                if (reason === 401 || reason === 405) fs.emptyDirSync(config.authPath);
                process.exit(1);
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
                const sender = msg.key.participant || jid;
                const text = getMessageText(msg).trim();
                const fromMe = msg.key.fromMe;

                if (jid.endsWith('@g.us') && !fromMe) {
                    msgStore.set(msg.key.id, { msg: msg.message, sender, timestamp: Date.now() });
                }

                console.log(`[TITAN] ${jid.split('@')[0]} | @${sender.split('@')[0]}: ${text || '(media)'}`);

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
                    await handleCommand(sock, msg, jid, sender, `_game_input_`, [], text);
                    continue;
                }

                const owner = isOwner(sender);
                if (!owner && !fromMe && config.mode === 'self') continue;

                if (!text.startsWith(config.prefix)) continue;

                const args = text.slice(config.prefix.length).trim().split(/\s+/);
                const cmd = args.shift().toLowerCase();
                await handleCommand(sock, msg, jid, sender, cmd, args, text, owner);

            } catch (e) {
                console.error('[TITAN] Handler Error:', e);
            }
        }
    });
}

startTitan();
