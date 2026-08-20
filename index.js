/**
 * TITAN WhatsApp Bot - Main Entry Point
 * Modularized & Optimized
 */

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, downloadMediaMessage, downloadContentFromMessage, proto } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs-extra');
const pino = require('pino');
const path = require('path');

// Modules
const { config, isOwner, isGroup, isChannel, getMessageText, getOwnerJid, settings, saveSettings, msgStore, spamTracker, gameStore, pendingVvKeys, getCachedGroupMetadata, isViewOnceStub, getViewOnceInfo, isBotAdmin, getGroupSettings, exportSessionBundle, restoreSessionFromId } = require('./utils');
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

// --- UNIVERSAL SESSION ID DECODER (FULL BUNDLE SUPPORT) ---
// Only use SESSION_ID if PAIRING_NUMBER is not set (fresh pairing preferred)
if (process.env.SESSION_ID && !process.env.PAIRING_NUMBER) {
    const credsPath = path.join(config.authPath, 'creds.json');
    let shouldRestore = !fs.existsSync(credsPath);

    if (!shouldRestore) {
        try {
            const currentCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8').trim());
            const sid = process.env.SESSION_ID.trim();
            let decodedRaw = sid.startsWith('{') ? sid : Buffer.from(sid.includes(':') ? sid.split(':')[1] : sid.includes('~') ? sid.split('~')[1] : sid, 'base64').toString('utf-8');
            const decodedParsed = JSON.parse(decodedRaw);
            const decodedCreds = decodedParsed['creds.json'] ? JSON.parse(decodedParsed['creds.json']) : decodedParsed;
            const currentId = currentCreds.me?.id || '';
            const decodedId = decodedCreds.me?.id || '';
            if (currentId && decodedId && currentId.split(':')[0] !== decodedId.split(':')[0]) {
                console.log('[TITAN] SESSION_ID belongs to a different account. Restoring new session...');
                shouldRestore = true;
            } else {
                console.log('[TITAN] SESSION_ID matches current account. Keeping auth intact.');
            }
        } catch (e) {
            shouldRestore = true;
        }
    }

    if (shouldRestore) {
        fs.removeSync(config.authPath);
        fs.ensureDirSync(config.authPath);
        restoreSessionFromId(process.env.SESSION_ID, config.authPath);
    }
}
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => res.json({ status: 'OK', uptime: process.uptime() }));
app.get('/ping', (req, res) => res.send('PONG'));

app.get('/api/status', (req, res) => {
    const isConnected = !!(currentSock && currentSock.user);
    const bundle = isConnected ? exportSessionBundle(config.authPath) : null;
    res.json({
        connected: isConnected,
        user: currentSock?.user?.id || null,
        sessionBundle: bundle
    });
});

app.post('/api/pair', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: 'Phone number required' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!cleanPhone) return res.status(400).json({ ok: false, error: 'Invalid phone number' });

    if (!currentSock) {
        return res.status(500).json({ ok: false, error: 'Bot socket initializing... Please try again in 5 seconds.' });
    }

    try {
        console.log('[TITAN WEB PAIR] Requesting code for:', cleanPhone);
        const code = await currentSock.requestPairingCode(cleanPhone);
        res.json({ ok: true, code });
    } catch (e) {
        console.error('[TITAN WEB PAIR] Error:', e.message);
        res.status(500).json({ ok: false, error: e.message || 'Failed to request pairing code' });
    }
});

app.post('/api/restore-session', async (req, res) => {
    const { session } = req.body;
    if (!session || !session.trim()) {
        return res.status(400).json({ ok: false, error: 'SESSION_ID key is required' });
    }

    try {
        console.log('[TITAN WEB RESTORE] Restoring session via Web Portal...');
        fs.removeSync(config.authPath);
        fs.ensureDirSync(config.authPath);
        
        const success = restoreSessionFromId(session.trim(), config.authPath);
        if (!success) {
            return res.status(400).json({ ok: false, error: 'Invalid or corrupt SESSION_ID format' });
        }

        res.json({ ok: true, message: 'Session restored successfully! Initializing bot connection...' });

        // Restart bot connection in background
        setTimeout(async () => {
            if (currentSock) {
                try { await currentSock.end(undefined); } catch (e) {}
            }
            startTitan();
        }, 1000);

    } catch (e) {
        console.error('[TITAN WEB RESTORE] Error:', e.message);
        res.status(500).json({ ok: false, error: e.message || 'Failed to restore session' });
    }
});

// Embedded Web Pairing Portal
app.get(['/', '/pair'], (req, res) => {
    const isConnected = !!(currentSock && currentSock.user);
    const sessionBundle = isConnected ? (exportSessionBundle(config.authPath) || '') : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TITAN Bot - Web Pairing Portal</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', sans-serif;
            background: #0d1117;
            color: #c9d1d9;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 16px;
            padding: 32px;
            max-width: 520px;
            width: 100%;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            text-align: center;
        }
        .logo { font-size: 42px; margin-bottom: 12px; }
        h1 { font-size: 26px; font-weight: 800; color: #58a6ff; margin-bottom: 8px; }
        p.subtitle { color: #8b949e; font-size: 14px; margin-bottom: 24px; }
        .status-badge {
            display: inline-block;
            padding: 6px 16px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 24px;
        }
        .status-online { background: rgba(46, 160, 67, 0.2); color: #3fb950; border: 1px solid #2ea043; }
        .status-offline { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid #d29922; }
        .input-group { margin-bottom: 20px; text-align: left; }
        label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #8b949e; }
        input[type="text"], textarea {
            width: 100%;
            padding: 12px 16px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            color: #f0f6fc;
            font-size: 15px;
            outline: none;
            transition: border-color 0.2s;
        }
        input[type="text"]:focus { border-color: #58a6ff; }
        button {
            width: 100%;
            padding: 14px;
            background: #238636;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.2s;
        }
        button:hover { background: #2ea043; }
        button:disabled { background: #30363d; cursor: not-allowed; color: #8b949e; }
        .code-box {
            background: #0d1117;
            border: 2px dashed #58a6ff;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            font-size: 32px;
            font-weight: 800;
            letter-spacing: 6px;
            color: #58a6ff;
        }
        .bundle-box {
            width: 100%;
            height: 120px;
            font-family: monospace;
            font-size: 12px;
            resize: none;
            margin-bottom: 12px;
        }
        .info-card {
            background: #1f242c;
            border-left: 4px solid #58a6ff;
            padding: 12px 16px;
            text-align: left;
            font-size: 13px;
            color: #8b949e;
            margin-top: 16px;
            border-radius: 4px;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🛡️</div>
        <h1>TITAN PAIRING PORTAL</h1>
        <p class="subtitle">Link your WhatsApp & copy your SESSION_ID key</p>

        <div id="statusBadge" class="status-badge ${isConnected ? 'status-online' : 'status-offline'}">
            ${isConnected ? '🟢 BOT ONLINE & CONNECTED' : '🟡 WAITING FOR LINK'}
        </div>

        <div id="pairForm" class="${isConnected ? 'hidden' : ''}">
            <div class="input-group">
                <label for="phone">Option 1: Request Pairing Code</label>
                <input type="text" id="phone" placeholder="e.g. 2348012345678 (country code, no +)">
            </div>
            <button id="btnPair" onclick="requestPairing()">⚡ Get Pairing Code</button>
            <div id="pairErr" style="color: #f85149; font-size: 13px; margin-top: 10px;"></div>

            <hr style="border: 0; border-top: 1px solid #30363d; margin: 28px 0;">

            <div class="input-group">
                <label for="sessionKey">Option 2: Already Have a SESSION_ID Key?</label>
                <textarea id="sessionKey" class="bundle-box" style="height: 80px;" placeholder="Paste your SESSION_ID key here..."></textarea>
            </div>
            <button id="btnRestore" style="background: #1f6beb;" onclick="restoreSession()">🚀 Restore & Activate Bot</button>
            <div id="restoreErr" style="color: #f85149; font-size: 13px; margin-top: 10px;"></div>
        </div>

        <div id="codeArea" class="hidden">
            <p style="font-size: 14px; color: #8b949e;">Your WhatsApp Pairing Code:</p>
            <div id="codeDisplay" class="code-box">------</div>
            <div class="info-card">
                <strong>How to link:</strong><br>
                1. Open WhatsApp on your phone.<br>
                2. Settings ➔ Linked Devices ➔ Link a Device.<br>
                3. Tap <em>"Link with phone number instead"</em> and enter this code.
            </div>
        </div>

        <div id="sessionArea" class="${isConnected ? '' : 'hidden'}">
            <p style="font-size: 14px; font-weight: 600; color: #3fb950; margin-bottom: 8px;">🎉 WhatsApp Connected Successfully!</p>
            <textarea id="sessionInput" class="bundle-box" readonly>${sessionBundle}</textarea>
            <button onclick="copySession()">📋 Copy SESSION_ID Key</button>
            <div class="info-card">
                <strong>Next Step:</strong> Paste this key as <code>SESSION_ID</code> in your host's Environment Variables so TITAN stays online permanently across server restarts!
            </div>
        </div>
    </div>

    <script>
        async function requestPairing() {
            const phone = document.getElementById('phone').value.trim();
            const btn = document.getElementById('btnPair');
            const err = document.getElementById('pairErr');
            err.innerText = '';

            if (!phone) {
                err.innerText = 'Please enter your phone number with country code.';
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Requesting Code...';

            try {
                const res = await fetch('/api/pair', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                const data = await res.json();
                if (data.ok && data.code) {
                    document.getElementById('codeDisplay').innerText = data.code;
                    document.getElementById('codeArea').classList.remove('hidden');
                    btn.innerText = 'Code Generated!';
                    startPolling();
                } else {
                    err.innerText = data.error || 'Failed to generate code.';
                    btn.disabled = false;
                    btn.innerText = '⚡ Get Pairing Code';
                }
            } catch (e) {
                err.innerText = 'Network error. Try again.';
                btn.disabled = false;
                btn.innerText = '⚡ Get Pairing Code';
            }
        }

        async function restoreSession() {
            const session = document.getElementById('sessionKey').value.trim();
            const btn = document.getElementById('btnRestore');
            const err = document.getElementById('restoreErr');
            err.innerText = '';

            if (!session) {
                err.innerText = 'Please paste your SESSION_ID key.';
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Restoring Session...';

            try {
                const res = await fetch('/api/restore-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session })
                });
                const data = await res.json();
                if (data.ok) {
                    btn.innerText = 'Session Restored! Connecting...';
                    startPolling();
                } else {
                    err.innerText = data.error || 'Failed to restore session.';
                    btn.disabled = false;
                    btn.innerText = '🚀 Restore & Activate Bot';
                }
            } catch (e) {
                err.innerText = 'Network error. Try again.';
                btn.disabled = false;
                btn.innerText = '🚀 Restore & Activate Bot';
            }
        }

        function copySession() {
            const text = document.getElementById('sessionInput');
            text.select();
            document.execCommand('copy');
            alert('SESSION_ID key copied to clipboard! Paste it into your host Environment Variables.');
        }

        let pollTimer = null;
        function startPolling() {
            if (pollTimer) return;
            pollTimer = setInterval(async () => {
                try {
                    const res = await fetch('/api/status');
                    const data = await res.json();
                    if (data.connected) {
                        clearInterval(pollTimer);
                        document.getElementById('statusBadge').className = 'status-badge status-online';
                        document.getElementById('statusBadge').innerText = '🟢 BOT ONLINE & CONNECTED';
                        document.getElementById('pairForm').classList.add('hidden');
                        document.getElementById('codeArea').classList.add('hidden');
                        if (data.sessionBundle) {
                            document.getElementById('sessionInput').value = data.sessionBundle;
                        }
                        document.getElementById('sessionArea').classList.remove('hidden');
                    }
                } catch(e) {}
            }, 3000);
        }

        if (!${isConnected}) startPolling();
    </script>
</body>
</html>`;
    res.send(html);
});

const server = app.listen(config.port, '0.0.0.0', () => console.log(`[TITAN] Server on ${config.port}`));
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[TITAN] Port ${config.port} is already in use.`);
        process.exit(1);
    }
});

// --- HANDLE UNCAUGHT ERRORS GRACEFULLY ---
process.on('uncaughtException', (err) => {
    const isNoiseError = err.message.includes('Unsupported state') ||
        err.message.includes('unable to authenticate data') ||
        err.message.includes('Bad MAC');

    if (isNoiseError) {
        console.error('[TITAN] Noise error (non-fatal):', err.message);
    } else {
        console.error('[TITAN] Uncaught Exception:', err);
        process.exit(1);
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
            await currentSock.end(undefined);
            console.log('[TITAN] Graceful logout successful. Old connection invalidated.');
        } catch (e) {
            console.log('[TITAN] Graceful logout error (can be ignored):', e.message);
        }
    }
    
    // Wait for pending creds writes to flush before exiting
    console.log('[TITAN] Waiting for creds flush...');
    await new Promise(r => setTimeout(r, 2000));
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
    
    // Validate creds.json before loading auth - auto-restore from backup if corrupt
    const credsFile = path.join(config.authPath, 'creds.json');
    const credsBak = credsFile + '.bak';
    try {
        if (fs.existsSync(credsFile)) {
            const raw = fs.readFileSync(credsFile, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed.me?.id) throw new Error('incomplete creds');
        }
    } catch (e) {
        console.warn('[TITAN] creds.json is corrupt:', e.message);
        if (fs.existsSync(credsBak)) {
            fs.copyFileSync(credsBak, credsFile);
            console.log('[TITAN] Restored creds from backup — no re-pair needed');
        } else {
            console.warn('[TITAN] No backup found. Will attempt to use existing auth (may fail).');
        }
    }
    
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
        printQRInTerminal: true,
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
    
    // --- PAIRING CODE SUPPORT (Termux-friendly) ---
    if (process.env.PAIRING_NUMBER && !fs.existsSync(path.join(config.authPath, 'creds.json'))) {
        const phone = process.env.PAIRING_NUMBER.replace(/[^0-9]/g, '');
        if (phone) {
            console.log('[TITAN] Requesting pairing code for:', phone);
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phone);
                    console.log('[TITAN] PAIRING CODE:', code);
                } catch (e) {
                    console.error('[TITAN] Pairing code error:', e.message);
                }
            }, 3000);
        }
    }

    // Store socket reference for graceful shutdown
    currentSock = sock;

    // --- PERIODIC CREDS BACKUP (prevents corruption from Ctrl+C) ---
    setInterval(() => {
        try {
            const credsFile = path.join(config.authPath, 'creds.json');
            if (fs.existsSync(credsFile)) {
                fs.copyFileSync(credsFile, credsFile + '.bak');
            }
        } catch (e) {
            console.error('[TITAN] Creds backup failed:', e.message);
        }
    }, 30000);

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
                    try {
                        const { msg, sender } = deletedMsg;
                        const header = `🗑️ *Anti-Delete Detected*\nSender: @${sender.split('@')[0]}`;
                        const text = getMessageText({ message: msg });
                        if (text) {
                            await sock.sendMessage(jid, { text: `${header}\n\n${text}`, mentions: [sender] });
                        } else {
                            await sock.sendMessage(jid, { text: header, mentions: [sender] });
                            await sock.sendMessage(jid, { forward: { key: { remoteJid: jid, fromMe: false, id: messageId, participant: sender }, message: msg } });
                        }
                    } catch (e) {
                        console.error('[TITAN ANTI-DELETE] Error:', e.message);
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
            
            // Auto-detect and set owner JID from connected account
            if (sock.user?.id) {
                const connectedPn = sock.user.id.split(':')[0].split('@')[0];
                if (!config.ownerNumber) config.ownerNumber = connectedPn;
                if (!settings.ownerJid) {
                    settings.ownerJid = `${connectedPn}@s.whatsapp.net`;
                    saveSettings();
                }
            }

            const ownerJidToSend = getOwnerJid(sock.user?.id);
            
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
                if (ownerJidToSend) {
                    await sock.sendMessage(ownerJidToSend, { text: '⚡ *TITAN SYSTEM ONLINE*\n\nGlobal Shields Active. Stability level: CRITICAL_MAX.' }).catch(() => {});
                }
            } else {
                console.log('[TITAN] Reconnected (skipping notification)');
            }

            // --- SESSION EXPORTER ---
            try {
                const sessionBundleString = exportSessionBundle(config.authPath);
                if (sessionBundleString && ownerJidToSend) {
                    await sock.sendMessage(ownerJidToSend, { text: `⚠️ *SESSION BACKUP (FULL BUNDLE)*\n\nCopy this key to your SESSION_ID env variable to keep session online across redeploys:\n\n${sessionBundleString}` }).catch(() => {});
                }
            } catch (e) { }

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
                  console.log('[TITAN] Max conflict attempts. Waiting 5 minutes before final retry...');
                   reconnectAttempts = 0;
                   setTimeout(() => startTitan(), 5 * 60 * 1000);
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
                try {
                    await sock.rejectCall(call.from, call.id);
                } catch (e) {
                    console.error('[TITAN SHIELD] Reject failed:', e.message);
                }

                const ownerJid = getOwnerJid();
                try {
                    await sock.sendMessage(call.from, { text: `🛡️ *TITAN IRON SHIELD*\n\nSorry, calls are not allowed. Please send a text message instead.` });
                } catch (e) {
                    console.error('[TITAN SHIELD] Refusal send failed:', e.message);
                }

                try {
                    await sock.sendMessage(ownerJid, {
                        text: `🚨 *IRON SHIELD ALERT*\n\nBlocked a call from: @${call.from.split('@')[0]}`,
                        mentions: [call.from]
                    });
                } catch (e) {
                    console.error('[TITAN SHIELD] Alert send failed:', e.message);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (!msg.key || !msg.key.remoteJid) {
                    console.log("[TITAN] SKIPPED NO KEY");
                    continue;
                }
                console.log("[INCOMING]", {
                    fromMe: msg.key?.fromMe,
                    jid: msg.key?.remoteJid,
                    hasMessage: !!msg.message,
                    keys: Object.keys(msg.message || {})
                });
                console.log("[MESSAGE FULL]", JSON.stringify(msg.message, null, 2));
                console.log("[RAW MSG]", JSON.stringify(msg.key, null, 2));
                const jid = msg.key.remoteJid || msg.key.participant || '';
                const fromMe = msg.key.fromMe;
                
                if (jid === 'status@broadcast' && settings.ghost) {
                    sock.readMessages([msg.key]).catch(() => { });
                    console.log(`[TITAN GHOST] Status viewed from: ${msg.pushName || 'Someone'}`);
                    continue;
                }

                // --- AUTO ANTI-VIEWONCE (PHASE ANTI-VV) ---
                if (settings.antivviewonce) {
                    const isPendingVv = pendingVvKeys.has(msg.key?.id);
                    if (isPendingVv) {
                        pendingVvKeys.delete(msg.key.id);
                        console.log(`[TITAN ANTI-VV] Pending VV response received for ${msg.key.id}`);
                    }
                    if (!fromMe || isPendingVv) {
                        const voInfo = getViewOnceInfo(msg);
                        if (voInfo) {
                            console.log(`[TITAN ANTI-VV] View once detected! Type: ${voInfo.type} from @${voInfo.sender.split('@')[0]}`);
                            try {
                                const mediaContent = voInfo.content.imageMessage || voInfo.content.videoMessage || voInfo.content.audioMessage;
                                if (!mediaContent) throw new Error('No media content found');
                                const stream = await downloadContentFromMessage(mediaContent, voInfo.type);
                                let buffer = Buffer.from([]);
                                for await (const chunk of stream) {
                                    buffer = Buffer.concat([buffer, chunk]);
                                }
                                const caption = `🕵️ *ANTI-VIEWONCE CATCH*\n\n👤 From: @${voInfo.sender.split('@')[0]}\n💬 Chat: ${voInfo.jid}\n⏰ Time: ${new Date(voInfo.timestamp * 1000).toLocaleString()}\n📎 Type: ${voInfo.type.toUpperCase()}`;
                                
                                if (voInfo.type === 'image') {
                                    await sock.sendMessage(getOwnerJid(), { image: buffer, caption, mentions: [voInfo.sender] });
                                } else if (voInfo.type === 'video') {
                                    await sock.sendMessage(getOwnerJid(), { video: buffer, caption, mentions: [voInfo.sender] });
                                } else if (voInfo.type === 'audio') {
                                    await sock.sendMessage(getOwnerJid(), { audio: buffer, mimetype: 'audio/mp4', caption: caption.replace(voInfo.type.toUpperCase(), 'AUDIO 🎤'), mentions: [voInfo.sender] });
                                }
                                console.log(`[TITAN ANTI-VV] Forwarded to owner successfully`);
                                // Continue to next message in batch (don't return, other msgs need processing)
                            } catch (vvErr) {
                                console.error('[TITAN ANTI-VV] Failed to capture:', vvErr.message);
                                if (!isPendingVv) {
                                    await attemptVVFallback(sock, msg, getOwnerJid());
                                }
                            }
                        } else if (msg.key?.isViewOnce) {
                            console.log(`[TITAN ANTI-VV] View once stub detected, requesting phone to re-upload...`);
                            pendingVvKeys.add(msg.key.id);
                            try {
                                await sock.sendPeerDataOperationMessage({
                                    placeholderMessageResendRequest: [{ messageKey: msg.key }],
                                    peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.PLACEHOLDER_MESSAGE_RESEND
                                });
                                setTimeout(() => {
                                    if (pendingVvKeys.has(msg.key.id)) {
                                        pendingVvKeys.delete(msg.key.id);
                                        attemptVVFallback(sock, msg, getOwnerJid());
                                    }
                                }, 10000);
                            } catch (pdoErr) {
                                console.error('[TITAN ANTI-VV] PDO request failed:', pdoErr.message);
                                pendingVvKeys.delete(msg.key.id);
                                await attemptVVFallback(sock, msg, getOwnerJid());
                            }
                        }
                    }
                }

                const sender = fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || jid);
                const rawText = getMessageText(msg);
                console.log("[TEXT RAW]", rawText);
                const text = (rawText || "").trim();

                // Store messages for Anti-Delete (All incoming)
                if (!fromMe) {
                    msgStore.set(msg.key.id, { msg: msg.message, sender, timestamp: Date.now() });
                }

                // --- AFK AUTO-REMOVE FOR SENDER ---
                if (settings.afk && settings.afk[sender]) {
                    const afkTime = settings.afk[sender].time;
                    const duration = moment.duration(Date.now() - afkTime).humanize();
                    delete settings.afk[sender];
                    saveSettings();
                    sock.sendMessage(jid, { text: `👋 *Welcome back @${sender.split('@')[0]}!* Your AFK status has been removed. (AFK for ${duration})`, mentions: [sender] }).catch(() => {});
                }

                // --- AFK MENTION / DM NOTIFIER ---
                if (settings.afk) {
                    const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const targetsToCheck = [...mentionedJids];
                    if (!isGroup(jid) && !fromMe && jid) targetsToCheck.push(jid);

                    for (const targetJid of targetsToCheck) {
                        const afkData = settings.afk[targetJid];
                        if (afkData && targetJid !== sender) {
                            const duration = moment.duration(Date.now() - afkData.time).humanize();
                            sock.sendMessage(jid, {
                                text: `💤 *@${targetJid.split('@')[0]} is currently AFK:*\n\n"*${afkData.reason}*"\n⏰ *Since:* ${duration} ago.`,
                                mentions: [targetJid]
                            }).catch(() => {});
                        }
                    }
                }

                console.log(`[TITAN] ${jid.split('@')[0]} | @${sender.split('@')[0]}: ${text || '(media)'}`);

                if (isGroup(jid) && !fromMe) {
                    if (await handleAntiLink(sock, msg, jid, text, sender)) continue;
                }

                // --- AUTO OWNER DETECTION (for LID support) ---
                if (sender && !settings.ownerJid) {
                    const senderNum = fromMe 
                        ? sock.user.id.split('@')[0].split(':')[0]
                        : sender.split('@')[0].split(':')[0];
                    let isOwnerMessage = senderNum === config.ownerNumber;
                    if (!isOwnerMessage && (sender.endsWith('@lid') || sender.endsWith('@hosted.lid') || sender.endsWith('@hosted'))) {
                        try {
                            const reversePath = path.join(config.authPath, `lid-mapping-${senderNum}_reverse.json`);
                            if (fs.existsSync(reversePath)) {
                                isOwnerMessage = fs.readJsonSync(reversePath) === config.ownerNumber;
                            }
                        } catch (e) {}
                    }
                    if (isOwnerMessage) {
                        settings.ownerJid = sender;
                        saveSettings();
                        sock.sendMessage(jid, { text: `🎉 *TITAN CONNECTED!*\n\nYou have been auto-detected as the **OWNER**. \n\nCommands are now locked to you. Type *${config.prefix}menu* to begin!` }).catch(() => { });
                    }
                }

                // --- MODE CONTROL ---
                const mode = config.mode || settings.mode || 'private';
                const owner = fromMe || isOwner(sender, fromMe);
                const isGroupChat = isGroup(jid);
                const isChannelChat = isChannel(jid);

                console.log("[DEBUG JID]", jid);
                console.log("[DEBUG TYPE]", {
                  isGroup: jid.endsWith("@g.us"),
                  isChannel: jid.endsWith("@newsletter"),
                  isStatus: jid === "status@broadcast"
                });
                console.log("[DEBUG MODE]", {
                  sender,
                  owner: isOwner(sender),
                  mode
                });
                let allowed = owner;
                if (!allowed) {
                    if (mode === 'public') allowed = true;
                    else if (mode === 'group' && (isGroupChat || isChannelChat)) allowed = true;
                }

                if (!allowed) continue;

                // Skip messages that failed decryption (CIPHERTEXT)
                if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT || !msg.message) {
                    console.log("[TITAN] SKIP undecryptable message");
                    continue;
                }

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
                                if (!meta) {
                                    console.log('[TITAN ANTI-SPAM] Could not fetch group metadata');
                                    continue;
                                }
                                const admins = getGroupAdmins(meta.participants || []);
                                const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                                if (admins.includes(botId) && !admins.includes(sender)) {
                                    await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} removed for spamming.`, mentions: [sender] });
                                    await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                                    continue;
                                }
                            } catch (e) {
                                console.error('[TITAN ANTI-SPAM] Error:', e.message);
                            }
                        }
                    }
                }

                // --- GAME INPUT ---
                const game = gameStore.get(jid);
                if (game && game.status === 'active' && !text.startsWith(config.prefix) && text) {
                    const trimmed = text.trim();
                    const isValidGuess = game.type === 'math'
                        ? /^-?\d+(\.\d+)?$/.test(trimmed)
                        : game.type === 'chess'
                            ? /^[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[KQRBNP])?[+#]?$|^O-O(?:-O)?[+#]?$/i.test(trimmed)
                            : /^[a-zA-Z]$/.test(trimmed);
                    if (isValidGuess) {
                        await handleCommand(sock, msg, jid, sender, `_game_input_`, [], text, owner);
                        continue;
                    }
                }

                console.log("[PREFIX CHECK]", { text, prefix: config.prefix, starts: text.startsWith(config.prefix), textLen: text.length });
                if (!text.startsWith(config.prefix)) continue;

                const args = text.slice(config.prefix.length).trim().split(/\s+/);
                const cmd = args.shift().toLowerCase();
                const cmdStart = Date.now();

                // --- COMMAND EXECUTION WITH ACCURATE STATUS REACTIONS ---
                try {
                    sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => { });
                    sock.sendPresenceUpdate('composing', jid).catch(() => { });

                    await handleCommand(sock, msg, jid, sender, cmd, args, text, owner, cmdStart);

                    sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => { });
                    sock.sendPresenceUpdate('paused', jid).catch(() => { });
                } catch (err) {
                    console.error('[TITAN COMMAND ERR]', err);
                    sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => { });
                    sock.sendPresenceUpdate('paused', jid).catch(() => { });
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

async function attemptVVFallback(sock, msg, ownerJid) {
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || jid;
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        if (buffer && buffer.length > 0) {
            const caption = `🕵️ *ANTI-VIEWONCE (via fallback)*\n\n👤 From: @${sender.split('@')[0]}\n💬 Chat: ${jid}`;
            const type = msg.message?.imageMessage ? 'image' : msg.message?.videoMessage ? 'video' : 'document';
            if (type === 'image') {
                await sock.sendMessage(ownerJid, { image: buffer, caption, mentions: [sender] });
            } else {
                await sock.sendMessage(ownerJid, { video: buffer, caption, mentions: [sender] });
            }
            console.log('[TITAN ANTI-VV] Fallback capture succeeded');
            return;
        }
    } catch (e) {
        console.log('[TITAN ANTI-VV] Fallback failed:', e.message);
    }
    try {
        await sock.sendMessage(ownerJid, {
            text: `🕵️ *ANTI-VIEWONCE*\n\n👤 From: @${sender.split('@')[0]}\n💬 Chat: ${jid}\n\n⚠️ WhatsApp didn't send the media content to the bot.\n📱 View the message on your phone, then reply with \`.vv\` to capture it.`,
            mentions: [sender]
        });
    } catch (e) {
        console.error('[TITAN ANTI-VV] Notification failed:', e.message);
    }
}

module.exports = { startTitan, reloadCommands };

startTitan();
