const { DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const config = {
    ownerNumber: (process.env.OWNER_NUMBER || '234xxxxxxxxxx').replace(/[^0-9]/g, ''),
    botName: process.env.BOT_NAME || 'TITAN',
    prefix: process.env.PREFIX || '.',
    mode: process.env.MODE || 'private',
    port: process.env.PORT || 3000,
    authPath: './auth_info',
    dataPath: './data',
    downloadPath: './downloads',
    logoPath: './titan_logo.png'
};

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
    getOwnerJid,
    isOwner,
    isGroup,
    getMessageText,
    getGroupAdmins
};
