require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

if (fs.existsSync('auth_debug')) {
    fs.rmSync('auth_debug', { recursive: true, force: true });
}

async function connect() {
    console.log('[DEBUG] Fetching version...');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[DEBUG] Baileys Version: ${version.join('.')}, isLatest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_debug');

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        logger: pino({ level: 'info' }), // Enable info logging to see issues
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection) console.log(`[DEBUG] Connection: ${connection}`);

        if (qr && !sock.authState.creds.registered) {
            console.log('[DEBUG] QR generated. Requesting pairing code...');
            try {
                // Short delay
                await new Promise(resolve => setTimeout(resolve, 3000));

                const number = process.env.OWNER_NUMBER;
                console.log(`[DEBUG] Requesting for ${number}`);
                const code = await sock.requestPairingCode(number);

                console.log('\n================================================');
                console.log('             PAIRING CODE');
                console.log(`             ${code}`);
                console.log('================================================\n');
            } catch (err) {
                console.error('[DEBUG] Failed to request code:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[DEBUG] Closed with status: ${statusCode}`);
            if (statusCode !== DisconnectReason.loggedOut) {
                // setTimeout(connect, 3000); // Disable auto-reconnect for debugging loop
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connect();
