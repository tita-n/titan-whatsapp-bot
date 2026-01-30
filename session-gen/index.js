const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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

app.post('/api/pair', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ error: 'Number required' });

    const cleanNumber = number.replace(/[^0-9]/g, '');
    const sessionId = `TITAN_GEN_${Math.random().toString(36).substring(7)}`;
    const sessionDir = path.join(__dirname, 'temp', sessionId);

    fs.ensureDirSync(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["TITAN SESSION GEN", "Edge", "1.0.0"]
    });

    try {
        await delay(3000);
        const code = await sock.requestPairingCode(cleanNumber);

        pairingStates.set(sessionId, { sock, sessionDir, saveCreds });

        res.json({ sessionId, code });

        // Auto-cleanup after 5 mins if not linked
        setTimeout(() => {
            if (pairingStates.has(sessionId)) {
                fs.removeSync(sessionDir);
                pairingStates.delete(sessionId);
            }
        }, 5 * 60 * 1000);

    } catch (e) {
        fs.removeSync(sessionDir);
        res.status(500).json({ error: 'Failed to request code' });
    }
});

app.post('/api/qr', async (req, res) => {
    const sessionId = `TITAN_QR_${Math.random().toString(36).substring(7)}`;
    const sessionDir = path.join(__dirname, 'temp', sessionId);

    fs.ensureDirSync(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["TITAN SESSION GEN", "Edge", "1.0.0"]
    });

    pairingStates.set(sessionId, { sock, sessionDir, saveCreds, qr: null });

    sock.ev.on('connection.update', (update) => {
        const { qr } = update;
        if (qr) {
            const current = pairingStates.get(sessionId);
            if (current) current.qr = qr;
        }
    });

    res.json({ sessionId });

    // Auto-cleanup after 5 mins if not linked
    setTimeout(() => {
        if (pairingStates.has(sessionId)) {
            fs.removeSync(sessionDir);
            pairingStates.delete(sessionId);
        }
    }, 5 * 60 * 1000);
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
        // Linked! Build the session ID
        const creds = fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf-8');
        const sessionString = Buffer.from(creds).toString('base64');

        // Clean up
        fs.removeSync(sessionDir);
        pairingStates.delete(sessionId);

        return res.json({ status: 'OK', session: sessionString });
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
            await axios.get(`${url}/ping`);
        } catch (e) { }
    }, 5 * 60 * 1000);
});
