/**
 * TITAN WhatsApp Bot - Main Entry Point
 * Modularized & Optimized
 */

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs-extra');
const pino = require('pino');

// Modules
const { config, isOwner, isGroup, getMessageText, getOwnerJid } = require('./utils');
const { handleCommand, handleAntiLink } = require('./commands');

// Ensure dirs
fs.ensureDirSync(config.authPath);
fs.ensureDirSync(config.dataPath);
fs.ensureDirSync(config.downloadPath);

// Express (Health Check)
const app = express();
app.get('/', (r, s) => s.send('TITAN Alive'));
app.listen(config.port, '0.0.0.0', () => console.log(`[TITAN] Server on ${config.port}`));

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
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        syncFullHistory: false // Speed up login
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection Logic
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !sock.authState.creds.registered) {
            console.log('[TITAN] Pairing required. Please use debug.js if not paired.');
            try {
                // AUTO-PAIR Attempt
                await new Promise(r => setTimeout(r, 2000));
                const code = await sock.requestPairingCode(config.ownerNumber);
                console.log(`PAIRING CODE: ${code}`);
            } catch (e) { }
        }

        if (connection === 'open') {
            console.log('[TITAN] ✅ Connected!');
            await sock.sendMessage(getOwnerJid(), { text: '[TITAN] System Online ⚡' });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === 401 || reason === 405) {
                console.log('[TITAN] Session Invalid. Re-pair needed.');
                fs.emptyDirSync(config.authPath);
                process.exit(1);
            } else if (reason !== DisconnectReason.loggedOut) {
                startTitan();
            } else {
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

                // Basic info
                const jid = msg.key.remoteJid;
                const sender = msg.key.participant || jid;
                const text = getMessageText(msg).trim();
                const fromMe = msg.key.fromMe;

                // 0. Anti-Link Check (Before anything else)
                if (isGroup(jid)) {
                    // This function handles the kick logic internally
                    if (await handleAntiLink(sock, msg, jid, text, sender)) continue;
                }

                // 1. Identity Check
                const owner = isOwner(sender);

                // Allow "Note to Self" (fromMe) IF it's the owner number
                if (!owner && !fromMe && config.mode === 'self') continue;

                // 2. Command Parsing
                if (!text.startsWith(config.prefix)) continue; // Ignore non-commands for speed

                const args = text.slice(config.prefix.length).trim().split(/\s+/);
                const cmd = args.shift().toLowerCase();

                // 3. Execution (No extra group checks - User requested "boom just enter group")
                console.log(`[TITAN] Cmd: ${cmd} from ${sender}`);

                await handleCommand(sock, msg, jid, sender, cmd, args, text);

            } catch (e) {
                console.error('[TITAN] Handler Error:', e);
            }
        }
    });
}

startTitan();
