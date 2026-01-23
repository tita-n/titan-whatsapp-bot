const { DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const config = {
    ownerNumber: (process.env.OWNER_NUMBER || '2348083433738').replace(/[^0-9]/g, ''),
    botName: process.env.BOT_NAME || 'TITAN',
    prefix: process.env.PREFIX || '.',
    mode: process.env.MODE || 'private',
    port: process.env.PORT || 3000,
    authPath: './auth_info',
    dataPath: './data',
    downloadPath: './downloads',
    logoPath: './titan_logo.png'
};

// Application State (Shared)
let settings = {
    antilink: {}, // jid: true/false
    welcome: {},  // jid: true/false
    goodbye: {},   // jid: true/false
    antiviewonce: {}, // jid: true/false (Passive Spy)
    antidelete: {}    // jid: true/false
};

const settingsPath = path.join(config.dataPath, 'settings.json');
const msgStorePath = path.join(config.dataPath, 'messages.json');

const saveSettings = () => {
    try {
        fs.writeJsonSync(settingsPath, settings, { spaces: 2 });
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

const saveMsgStore = () => {
    try {
        const data = Array.from(msgStore.entries());
        fs.writeJsonSync(msgStorePath, data);
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

// Simple In-Memory Message Store for Anti-Delete
// Key: msgId, Value: { msg, sender, timestamp }
const msgStore = new Map();

// Helper to cleanup store
function cleanupStore() {
    if (msgStore.size > 1000) {
        const keys = Array.from(msgStore.keys()).slice(0, 200); // Remove oldest 200
        keys.forEach(k => msgStore.delete(k));
        saveMsgStore(); // Save after cleanup
    }
}
setInterval(cleanupStore, 10 * 60 * 1000); // Every 10 mins

// Helpers
const getOwnerJid = () => `${config.ownerNumber}@s.whatsapp.net`;

const isOwner = (jid) => {
    if (!jid) return false;
    const num = jid.split('@')[0].split(':')[0];
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

const getGroupAdmins = (participants) => {
    return participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
};

module.exports = {
    config,
    settings,
    saveSettings,
    msgStore,
    getOwnerJid,
    isOwner,
    isGroup,
    getMessageText,
    getGroupAdmins
};
