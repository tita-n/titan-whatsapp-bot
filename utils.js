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
    logoBuffer: fs.existsSync('./titan_logo.png') ? fs.readFileSync('./titan_logo.png') : null,
    supportGroup: 'GrrmfoKyFyC24okI6bzBWe',
    supportChannel: '120363402818387361@newsletter'
};

// Application State (Shared)
let settings = {
    antilink: false,   // Global Toggle
    welcome: false,    // Global Toggle
    goodbye: false,    // Global Toggle
    antivviewonce: false, // Global Toggle - renamed to avoid conflict
    antidelete: false,  // Global Toggle
    antispam: false,    // Global Toggle
    supportGroup: '',   // Dynamic Group Code
    supportChannel: '', // Dynamic Channel ID
    appUrl: '',         // Bot's own URL (For self-ping)
    mode: 'private',    // Global Bot Mode: private, public, group
    ownerJid: '',       // Dynamic Owner (for templates)
    reminders: [],       // Array of { id, jid, text, time }
    todo: {},             // jid: [tasks]
    anticall: false,      // Global Anti-Call Toggle
    ghost: false,         // Auto-Status View
    pulse: false          // Auto-Bio Update
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
const isChannel = (jid) => jid?.endsWith('@newsletter');

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
        content.newsletterAction?.text || // Handle some channel specific actions if needed
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

// ============================================================
// VIEW ONCE HELPERS - Bullet-proof detection for Baileys v7+
// ============================================================

/**
 * Check if message is a view-once stub (already viewed/expired)
 * @param {Object} msg - The message object
 * @returns {boolean} True if it's a stub (already viewed)
 */
const isViewOnceStub = (msg) => {
    return msg.key?.isViewOnce === true && 
           (msg.messageStubType === 'Message absent from node' || 
            msg.messageStubParameters?.includes('Message absent from node'));
};

/**
 * Extract view-once message from ANY nested path
 * Handles: viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension, ephemeralMessage
 * @param {Object} message - The message object
 * @returns {Object|null} The unwrapped message content or null
 */
const extractViewOnceContent = (message) => {
    if (!message) return null;
    
    // Try ALL possible paths for view-once detection
    const paths = [
        // Direct viewOnce paths
        () => message.viewOnceMessage?.message,
        () => message.viewOnceMessageV2?.message,
        () => message.viewOnceMessageV2Extension?.message,
        // Ephemeral wrapped
        () => message.ephemeralMessage?.message?.viewOnceMessage?.message,
        () => message.ephemeralMessage?.message?.viewOnceMessageV2?.message,
        () => message.ephemeralMessage?.message?.viewOnceMessageV2Extension?.message,
        // Associated child (new in 2025)
        () => message.associatedChildMessage?.message?.viewOnceMessage?.message,
        () => message.associatedChildMessage?.message?.viewOnceMessageV2?.message,
        () => message.associatedChildMessage?.message?.viewOnceMessageV2Extension?.message,
    ];
    
    for (const tryPath of paths) {
        try {
            const result = tryPath();
            if (result && (result.imageMessage || result.videoMessage || result.audioMessage)) {
                return result;
            }
        } catch (e) {
            // Continue to next path
        }
    }
    
    return null;
};

/**
 * Detect if message contains view-once media (returns the type)
 * @param {Object} msg - The message object  
 * @returns {string|null} 'image', 'video', 'audio' or null
 */
const detectViewOnceType = (msg) => {
    const content = extractViewOnceContent(msg.message);
    if (!content) return null;
    
    if (content.imageMessage) return 'image';
    if (content.videoMessage) return 'video';
    if (content.audioMessage) return 'audio';
    
    return null;
};

/**
 * Check if incoming message has view-once content (for auto anti-VV)
 * @param {Object} msg - The raw message from messages.upsert
 * @returns {Object|null} { type, content, sender, jid } or null
 */
const getViewOnceInfo = (msg) => {
    const content = extractViewOnceContent(msg.message);
    if (!content) return null;
    
    const type = content.imageMessage ? 'image' : content.videoMessage ? 'video' : content.audioMessage ? 'audio' : null;
    if (!type) return null;
    
    return {
        type,
        content,
        sender: msg.key.participant || msg.key.remoteJid,
        jid: msg.key.remoteJid,
        pushName: msg.pushName,
        timestamp: msg.messageTimestamp
    };
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
    isChannel,
    getMessageText,
    getGroupAdmins,
    getCachedGroupMetadata,
    // View Once helpers
    isViewOnceStub,
    extractViewOnceContent,
    detectViewOnceType,
    getViewOnceInfo
};
