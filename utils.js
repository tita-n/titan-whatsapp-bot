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
const settings = {
    antilink: {}, // jid: true/false
    welcome: {},  // jid: true/false
    goodbye: {},   // jid: true/false
    antiviewonce: {}, // jid: true/false (Passive Spy)
    antidelete: {}    // jid: true/false
};

// Simple In-Memory Message Store for Anti-Delete
// Key: msgId, Value: { msg, sender, timestamp }
const msgStore = new Map();

// Helper to cleanup store
function cleanupStore() {
    if (msgStore.size > 1000) {
        const keys = Array.from(msgStore.keys()).slice(0, 200); // Remove oldest 200
        keys.forEach(k => msgStore.delete(k));
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
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
        m.videoMessage?.caption || m.documentMessage?.caption || '';
};

const getGroupAdmins = (participants) => {
    return participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
};

module.exports = {
    config,
    settings,
    msgStore,
    getOwnerJid,
    isOwner,
    isGroup,
    getMessageText,
    getGroupAdmins
};
