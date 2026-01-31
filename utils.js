const { DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const config = {
    ownerNumber: (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, ''),
    botName: process.env.BOT_NAME || 'TITAN',
    prefix: process.env.PREFIX || '.',
    mode: process.env.MODE || 'private',
    repoUrl: 'https://github.com/tita-n/titan-whatsapp-bot.git',
    port: process.env.PORT ? parseInt(process.env.PORT.toString().trim()) : 3000,
    authPath: './auth_info',
    dataPath: './data',
    downloadPath: './downloads',
    logoPath: './titan_logo.png',
    supportGroup: 'GrrmfoKyFyC24okI6bzBWe',
    supportChannel: '120363402818387361@newsletter'
};

// Application State (Shared)
let settings = {
    antilink: {}, // jid: true/false
    welcome: {},  // jid: true/false
    goodbye: {},   // jid: true/false
    antiviewonce: {}, // jid: true/false (Passive Spy)
    antidelete: {},    // jid: true/false
    antispam: {},       // jid: true/false
    supportGroup: '',   // Dynamic Group Code
    supportChannel: '', // Dynamic Channel ID
    appUrl: '',         // Bot's own URL (For self-ping)
    mode: 'private',    // Global Bot Mode: private, public, group
    ownerJid: '',       // Dynamic Owner (for templates)
    reminders: [],       // Array of { id, jid, text, time }
    todo: {}             // jid: [tasks]
};

// Application Stores
const msgStore = new Map();
const spamTracker = new Map();
const gameStore = new Map();

const settingsPath = path.join(config.dataPath, 'settings.json');
const msgStorePath = path.join(config.dataPath, 'messages.json');

const saveSettings = async () => {
    try {
        await fs.writeJson(settingsPath, settings, { spaces: 2 });
    } catch (e) {
        console.error('[TITAN] Failed to save settings:', e);
    }
};

const loadSettings = () => {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readJsonSync(settingsPath);
            Object.assign(settings, data);
            console.log('[TITAN] Settings loaded from disk.');
        }
    } catch (e) {
        console.error('[TITAN] Failed to load settings:', e);
    }
};

const saveMsgStore = async () => {
    try {
        const data = Array.from(msgStore.entries());
        await fs.writeJson(msgStorePath, data);
    } catch (e) {
        console.error('[TITAN] Failed to save msgStore:', e);
    }
};

const loadMsgStore = () => {
    try {
        if (fs.existsSync(msgStorePath)) {
            const data = fs.readJsonSync(msgStorePath);
            data.forEach(([k, v]) => msgStore.set(k, v));
            console.log(`[TITAN] ${msgStore.size} messages loaded from disk.`);
        }
    } catch (e) {
        console.error('[TITAN] Failed to load msgStore:', e);
    }
};

// Graceful Exit
process.on('SIGINT', () => {
    console.log('[TITAN] Shutting down... Saving data.');
    saveSettings();
    saveMsgStore();
    process.exit(0);
});

process.on('SIGTERM', () => {
    saveSettings();
    saveMsgStore();
    process.exit(0);
});

// Auto-load on require
loadSettings();
loadMsgStore();

// Helpers

// Helper to cleanup store
function cleanupStore() {
    // Msg Store Cleanup
    if (msgStore.size > 1000) {
        const keys = Array.from(msgStore.keys()).slice(0, 200); // Remove oldest 200
        keys.forEach(k => msgStore.delete(k));
        saveMsgStore(); // Save after cleanup
    }

    // Spam Tracker Periodic Cleanup (Clear every 10 mins)
    spamTracker.clear();
}
setInterval(cleanupStore, 10 * 60 * 1000); // Every 10 mins

// Helpers
const getOwnerJid = () => `${config.ownerNumber}@s.whatsapp.net`;

const isOwner = (jid) => {
    if (!jid) return false;
    const num = jid.split('@')[0].split(':')[0];
    // Priority: Dynamic Setting > Env Variable
    if (settings.ownerJid) return jid.split('@')[0] === settings.ownerJid.split('@')[0];
    return num === config.ownerNumber;
};

const isGroup = (jid) => jid?.endsWith('@g.us');

const getMessageText = (msg) => {
    const m = msg.message;
    if (!m) return '';
    // Handle wrapped ViewOnce messages (for manual .vv command)
    const content = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m;

    return content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        content.documentMessage?.caption ||
        content.buttonsResponseMessage?.selectedButtonId ||
        content.listResponseMessage?.singleSelectReply?.selectedRowId ||
        '';
};

// Metadata Cache (JID -> { data, timestamp })
const metadataCache = new Map();

const getCachedGroupMetadata = async (sock, jid) => {
    const cached = metadataCache.get(jid);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) { // 5 min cache
        return cached.data;
    }
    try {
        const meta = await sock.groupMetadata(jid);
        metadataCache.set(jid, { data: meta, timestamp: Date.now() });
        return meta;
    } catch (e) {
        console.error('[TITAN] Group Metadata Fetch Error:', e);
        return null;
    }
};

const getGroupAdmins = (participants) => {
    return participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
};

module.exports = {
    config,
    settings,
    saveSettings,
    msgStore,
    spamTracker,
    gameStore,
    getOwnerJid,
    isOwner,
    isGroup,
    getMessageText,
    getGroupAdmins,
    getCachedGroupMetadata
};
