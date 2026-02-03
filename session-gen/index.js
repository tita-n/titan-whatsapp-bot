const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('session-gen/public'));

// Pairing Store (In-memory for security)
const pairingStates = new Map();
const qrImage = require('qr-image');

app.get('/ping', (req, res) => res.send('OK'));

async function getVersion() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        return version;
    } catch {
        return [2, 3000, 1015901307]; // Fallback
    }
}

app.post('/api/pair', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ error: 'Number required' });

    const cleanNumber = number.replace(/[^0-9]/g, '');
    const sessionId = `TITAN_GEN_${Math.random().toString(36).substring(7)}`;
    const sessionDir = path.join(__dirname, 'temp', sessionId);

    fs.ensureDirSync(sessionDir);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const version = await getVersion();

        const sock = makeWASocket({
            version,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            browser: Browsers.ubuntu('Chrome')
        });

        sock.ev.on('creds.update', saveCreds);

        console.log(`[TITAN GEN] Requesting pairing code for: ${cleanNumber}`);
        // Wait for connection to stabilize
        await delay(5000);

        let code;
        try {
            code = await sock.requestPairingCode(cleanNumber);
            console.log(`[TITAN GEN] Code generated: ${code}`);
        } catch (err) {
            console.error('[TITAN GEN] Pairing Request Failed:', err.message);
            throw new Error('Failed to fetch pairing code from WhatsApp');
        }

        pairingStates.set(sessionId, { sock, sessionDir, saveCreds, lastUpdate: Date.now() });

        res.json({ sessionId, code });

        // Auto-cleanup after 5 mins if not linked
        setTimeout(() => {
            if (pairingStates.has(sessionId)) {
                try {
                    pairingStates.get(sessionId).sock.ev.removeAllListeners();
                    pairingStates.get(sessionId).sock.logout();
                } catch (e) { }
                fs.removeSync(sessionDir);
                pairingStates.delete(sessionId);
            }
        }, 5 * 60 * 1000);

    } catch (e) {
        console.error(`[TITAN GEN] Pairing Error for ${cleanNumber}:`, e);
        fs.removeSync(sessionDir);
        res.status(500).json({ error: 'Failed to request code' });
    }
});

app.post('/api/qr', async (req, res) => {
    const sessionId = `TITAN_QR_${Math.random().toString(36).substring(7)}`;
    const sessionDir = path.join(__dirname, 'temp', sessionId);

    fs.ensureDirSync(sessionDir);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const version = await getVersion();

        const sock = makeWASocket({
            version,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            browser: Browsers.ubuntu('Chrome')
        });

        sock.ev.on('creds.update', saveCreds);

        pairingStates.set(sessionId, { sock, sessionDir, saveCreds, qr: null, lastUpdate: Date.now() });

        sock.ev.on('connection.update', (update) => {
            const { qr, connection, lastDisconnect } = update;
            const current = pairingStates.get(sessionId);
            if (!current) return;

            if (qr) {
                console.log(`[TITAN GEN] QR Generated: ${sessionId}`);
                current.qr = qr;
                current.lastUpdate = Date.now();
            }
            if (connection === 'open') {
                console.log(`[TITAN GEN] Session Linked: ${sessionId}`);
            }
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log(`[TITAN GEN] Socket Closed: ${sessionId} (Reason: ${reason})`);
                if (reason !== DisconnectReason.loggedOut) {
                    // Attempt to handle specific failures if needed
                }
            }
        });

        res.json({ sessionId });

        // Auto-cleanup after 5 mins
        setTimeout(() => {
            if (pairingStates.has(sessionId)) {
                try {
                    pairingStates.get(sessionId).sock.ev.removeAllListeners();
                    pairingStates.get(sessionId).sock.logout();
                } catch (e) { }
                fs.removeSync(sessionDir);
                pairingStates.delete(sessionId);
            }
        }, 5 * 60 * 1000);

    } catch (e) {
        console.error(`[TITAN GEN] QR Init Error:`, e);
        fs.removeSync(sessionDir);
        res.status(500).json({ error: 'Failed to initialize QR' });
    }
});

app.get('/api/qr-image/:sessionId', (req, res) => {
    const state = pairingStates.get(req.params.sessionId);
    if (!state || !state.qr) return res.status(404).send('QR not available');

    const code = qrImage.image(state.qr, { type: 'png', ec_level: 'H' });
    res.type('png');
    code.pipe(res);
});

app.get('/api/check/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const state = pairingStates.get(sessionId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const { sock, sessionDir } = state;

    if (sock.user) {
        try {
            const credsFile = path.join(sessionDir, 'creds.json');
            if (fs.existsSync(credsFile)) {
                const creds = fs.readFileSync(credsFile, 'utf-8');
                const sessionString = Buffer.from(creds).toString('base64');

                // Final cleanup
                try { sock.ev.removeAllListeners(); sock.logout(); } catch (e) { }
                fs.removeSync(sessionDir);
                pairingStates.delete(sessionId);

                return res.json({ status: 'OK', session: sessionString });
            }
        } catch (e) { }
    }

    res.json({ status: 'WAITING', qr: state.qr });
});

app.listen(PORT, () => {
    console.log(`[TITAN GEN] Running on port ${PORT}`);

    // Self-pinger loop
    setInterval(async () => {
        const url = process.env.APP_URL || `http://localhost:${PORT}`;
        try {
            const axios = require('axios');
            await axios.get(`${url}/ping`).catch(() => null);
        } catch (e) { }
    }, 5 * 60 * 1000);
});
