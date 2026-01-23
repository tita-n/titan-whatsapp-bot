const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const moment = require('moment');
const fs = require('fs-extra');
const axios = require('axios');
const { config, settings, saveSettings, getOwnerJid, isGroup, getGroupAdmins } = require('./utils');

async function handleAntiLink(sock, msg, jid, text, sender) {
    if (!settings.antilink[jid]) return false; // Use Shared Settings

    // Regex for WhatsApp links
    const linkRegex = /chat\.whatsapp\.com\/[0-9A-Za-z]{20,}/i;
    if (!linkRegex.test(text)) return false;

    try {
        const meta = await sock.groupMetadata(jid);
        const admins = getGroupAdmins(meta.participants);
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        const isSenderAdmin = admins.includes(sender);
        const isBotAdmin = admins.includes(botJid);

        if (isSenderAdmin) return false;
        if (!isBotAdmin) return false;

        await sock.sendMessage(jid, { delete: msg.key });
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        return true;
    } catch (e) {
        console.error('[TITAN] Antilink check failed:', e);
        return false;
    }
}

async function handleCommand(sock, msg, jid, sender, cmd, args, text) {
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;

    const getTarget = () => {
        if (mentions.length > 0) return mentions[0];
        if (quotedSender) return quotedSender;
        if (args[0]) {
            const num = args[0].replace('@', '').replace(/[^0-9]/g, '');
            if (num) return `${num}@s.whatsapp.net`;
        }
        return null;
    };

    const sendWithLogo = async (text, mentions = []) => {
        const caption = `*「 ${config.botName} 」*\n\n${text}`;
        if (fs.existsSync(config.logoPath)) {
            await sock.sendMessage(jid, { image: fs.readFileSync(config.logoPath), caption, mentions });
        } else {
            await sock.sendMessage(jid, { text: caption, mentions });
        }
    };

    switch (cmd) {
        case 'menu':
        case 'help':
            const menuText = `*🤖 TITAN BOT COMMANDS*
Prefix: *${config.prefix}*

*🛠️ Utility*
*${config.prefix}ping* - Check speed
*${config.prefix}status* - Uptime
*${config.prefix}menu* - Show this
*${config.prefix}vv* - Retrieve ViewOnce
*${config.prefix}vv2* - Silent Owner VV
*${config.prefix}link* - Get group link
*${config.prefix}revoke* - Reset group link

*📢 Group*
*${config.prefix}tagall [msg]* - Tag everyone
*${config.prefix}hidetag [msg]* - Invisible tag
*${config.prefix}broadcast [msg]* - Owner BC
*${config.prefix}welcome [on/off]* - Auto welcome
*${config.prefix}goodbye [on/off]* - Auto goodbye

*👮‍♂️ Admin*
*${config.prefix}kick [user]* - Remove user
*${config.prefix}promote [user]* - Make admin
*${config.prefix}demote [user]* - Remove admin
*${config.prefix}mute* - Close group
*${config.prefix}unmute* - Open group
*${config.prefix}delete* - Delete message
*${config.prefix}antilink [on/off]* - Auto-kick links

*${config.prefix}sticker* - Create sticker
*${config.prefix}download [url]* - Sc-Media Downloader (TikTok, IG, YT)
*${config.prefix}d [url]* - Shortcut for download`;
            await sendWithLogo(menuText);
            break;

        case 'status':
            await sendWithLogo(`Bot active.\nUptime: ${moment.duration(Date.now() - startTime).humanize()}`);
            break;

        case 'ping':
            const start = Date.now();
            await sock.sendMessage(jid, { text: 'Testing speed...' });
            await sendWithLogo(`Pong! 🏓\nResponse: *${Date.now() - start}ms*`);
            break;

        case 'tagall':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            try {
                const meta = await sock.groupMetadata(jid);
                const participants = meta.participants || [];
                const mentions = participants.map(p => p.id);
                const message = args.join(' ') || '📢 *Attention Everyone*';
                const textBody = `${message}\n\n${mentions.map(m => `@${m.split('@')[0]}`).join(' ')}`;
                await sock.sendMessage(jid, { text: textBody, mentions });
            } catch (e) {
                await sendWithLogo('❌ Failed. Bot needs admin?');
            }
            break;

        /* ADMIN COMMANDS */
        case 'kick':
        case 'remove':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            const targetKick = getTarget();
            if (!targetKick) return sendWithLogo('❌ Tag or reply to a user.');
            try {
                await sock.groupParticipantsUpdate(jid, [targetKick], 'remove');
                await sendWithLogo('👋 User kicked.');
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'promote':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            const targetPromote = getTarget();
            if (!targetPromote) return sendWithLogo('❌ Tag or reply to a user.');
            try {
                await sock.groupParticipantsUpdate(jid, [targetPromote], 'promote');
                await sendWithLogo('👮‍♂️ Promoted to Admin.');
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'demote':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            const targetDemote = getTarget();
            if (!targetDemote) return sendWithLogo('❌ Tag or reply to a user.');
            try {
                await sock.groupParticipantsUpdate(jid, [targetDemote], 'demote');
                await sendWithLogo('📉 Demoted from Admin.');
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'mute':
        case 'close':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                await sendWithLogo('🔒 Group Closed.');
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'unmute':
        case 'open':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                await sendWithLogo('🔓 Group Open.');
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'antilink':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            // Toggle Logic if no arg, or context aware
            if (!args[0]) {
                const current = settings.antilink[jid];
                settings.antilink[jid] = !current;
                saveSettings();
                await sendWithLogo(settings.antilink[jid] ? '✅ Antilink Enabled.' : '❌ Antilink Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.antilink[jid] = true;
                saveSettings();
                await sendWithLogo('✅ Antilink Enabled.');
            } else if (args[0] === 'off') {
                settings.antilink[jid] = false;
                saveSettings();
                await sendWithLogo('❌ Antilink Disabled.');
            }
            break;

        case 'welcome':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            if (!args[0]) {
                const current = settings.welcome[jid];
                settings.welcome[jid] = !current;
                saveSettings();
                await sendWithLogo(settings.welcome[jid] ? '✅ Welcome msg Enabled.' : '❌ Welcome msg Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.welcome[jid] = true;
                saveSettings();
                await sendWithLogo('✅ Welcome msg Enabled.');
            } else if (args[0] === 'off') {
                settings.welcome[jid] = false;
                saveSettings();
                await sendWithLogo('❌ Welcome msg Disabled.');
            }
            break;

        case 'goodbye':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            if (!args[0]) {
                const current = settings.goodbye[jid];
                settings.goodbye[jid] = !current;
                saveSettings();
                await sendWithLogo(settings.goodbye[jid] ? '✅ Goodbye msg Enabled.' : '❌ Goodbye msg Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.goodbye[jid] = true;
                saveSettings();
                await sendWithLogo('✅ Goodbye msg Enabled.');
            } else if (args[0] === 'off') {
                settings.goodbye[jid] = false;
                saveSettings();
                await sendWithLogo('❌ Goodbye msg Disabled.');
            }
            break;

        /* NEW ANTI-FEATURES */
        case 'vv':
        case 'vv2':
        case 'retrieve':
            try {
                const target = quoted || msg.message;
                const voContent = target.viewOnceMessage || target.viewOnceMessageV2;

                if (!voContent) {
                    if (cmd !== 'vv2') return sendWithLogo('❌ Reply to a ViewOnce message.');
                    return;
                }

                const actualMessage = voContent.message;
                const type = Object.keys(actualMessage).find(k => k.endsWith('Message'));
                const media = actualMessage[type];

                if (!media) return;

                const stream = await downloadContentFromMessage(media, type.replace('Message', ''));
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const targetJid = cmd === 'vv2' ? getOwnerJid() : sender;
                const caption = cmd === 'vv2' ? `🕵️ *Silent VV* (from @${sender.split('@')[0]})` : '🙈 Recovered ViewOnce';

                if (type.includes('image')) {
                    await sock.sendMessage(targetJid, { image: buffer, caption, mentions: [sender] });
                } else if (type.includes('video')) {
                    await sock.sendMessage(targetJid, { video: buffer, caption, mentions: [sender] });
                }

                if (cmd !== 'vv2') await sendWithLogo('✅ Sent to your DM.');

            } catch (e) {
                console.error('[TITAN] VV Error:', e);
                if (cmd !== 'vv2') await sendWithLogo('❌ Failed to retrieve. Message might be too old.');
            }
            break;

        case 'antiviewonce':
        case 'antivv':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            if (!args[0]) {
                const current = settings.antiviewonce[jid];
                settings.antiviewonce[jid] = !current;
                saveSettings();
                await sendWithLogo(settings.antiviewonce[jid] ? '✅ Spy Mode Updated: Pasive Anti-ViewOnce Enabled.' : '❌ Spy Mode Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.antiviewonce[jid] = true;
                saveSettings();
                await sendWithLogo('✅ Spy Mode Enabled.');
            } else if (args[0] === 'off') {
                settings.antiviewonce[jid] = false;
                saveSettings();
                await sendWithLogo('❌ Spy Mode Disabled.');
            }
            break;

        case 'antidelete':
        case 'antidel':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            if (!args[0]) {
                const current = settings.antidelete[jid];
                settings.antidelete[jid] = !current;
                saveSettings();
                await sendWithLogo(settings.antidelete[jid] ? '✅ Anti-Delete Enabled.' : '❌ Anti-Delete Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.antidelete[jid] = true;
                saveSettings();
                await sendWithLogo('✅ Anti-Delete Enabled.');
            } else if (args[0] === 'off') {
                settings.antidelete[jid] = false;
                saveSettings();
                await sendWithLogo('❌ Anti-Delete Disabled.');
            }
            break;

        /* NEW BATCH 5 COMMANDS */
        case 'link':
        case 'invite':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            try {
                const code = await sock.groupInviteCode(jid);
                await sendWithLogo(`🔗 *Group Link check it out:*\nhttps://chat.whatsapp.com/${code}`);
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'revoke':
        case 'reset':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            try {
                await sock.groupRevokeInvite(jid);
                await sendWithLogo('🔄 Group link reset!');
            } catch (e) { await sendWithLogo('❌ Failed. Bot admin?'); }
            break;

        case 'hidetag':
        case 'ht':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            try {
                const meta = await sock.groupMetadata(jid);
                const participants = meta.participants || [];
                const mentions = participants.map(p => p.id);
                const message = args.join(' ') || '📢';
                await sock.sendMessage(jid, { text: message, mentions });
            } catch (e) { await sendWithLogo('❌ Failed.'); }
            break;

        case 'delete':
        case 'del':
            if (!quoted) return sendWithLogo('❌ Reply to a message to delete.');
            try {
                const stanzaId = msg.message.extendedTextMessage.contextInfo.stanzaId;
                const isBotMessage = quotedSender && quotedSender.includes(sock.user.id.split(':')[0]);

                const key = {
                    remoteJid: jid,
                    fromMe: isBotMessage,
                    id: stanzaId,
                    participant: quotedSender
                };

                await sock.sendMessage(jid, { delete: key });
            } catch (e) {
                await sendWithLogo('❌ Failed to delete. Am I admin?');
            }
            break;

        case 'broadcast':
        case 'bc':
            if (!sender.includes(config.ownerNumber)) return;
            const bcMsg = args.join(' ');
            if (!bcMsg) return sendWithLogo('❌ Enter message.');

            const groups = await sock.groupFetchAllParticipating();
            const groupIds = Object.keys(groups);

            await sendWithLogo(`📢 Broadcasting to ${groupIds.length} groups...`);

            for (const gJid of groupIds) {
                try {
                    await sock.sendMessage(gJid, { text: `*📢 [TITAN BROADCAST]*\n\n${bcMsg}` });
                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) { }
            }
            await sendWithLogo('✅ Broadcast complete.');
            break;

        case 'sticker':
        case 's':
            try {
                const targetMsg = quoted || msg.message;
                const mime = targetMsg.imageMessage?.mimetype || targetMsg.videoMessage?.mimetype;

                if (mime) {
                    const buffer = await downloadMediaMessage({ message: targetMsg }, 'buffer', {});
                    await sock.sendMessage(jid, { sticker: buffer });
                } else {
                    await sendWithLogo('❌ Reply to an image/video with .sticker');
                }
            } catch (e) {
                await sendWithLogo('❌ conversion failed.');
            }
            break;

        case 'download':
        case 'd':
            if (!args[0]) return sendWithLogo('❌ Please provide a link (TikTok, Instagram, YouTube, etc.)');
            const url = args[0];

            try {
                await sock.sendMessage(jid, { text: '⏬ *Fetching media...* Please wait.' }, { quoted: msg });

                // Cobalt API Request
                const response = await axios.post('https://api.cobalt.tools/api/json', {
                    url: url,
                    videoQuality: '720',
                    filenameStyle: 'basic'
                }, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                const data = response.data;

                if (data.status === 'error') {
                    return sendWithLogo(`❌ Cobalt Error: ${data.text}`);
                }

                if (data.status === 'stream' || data.status === 'picker' || data.status === 'redirect') {
                    const downloadUrl = data.url;
                    if (!downloadUrl) return sendWithLogo('❌ Could not get download URL.');

                    // Fetch the actual media buffer
                    const mediaRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(mediaRes.data);

                    // Determine file type from extension if possible, or default to video
                    // Cobalt usually returns mp4 or jpg/png
                    const isImage = data.filename?.endsWith('.jpg') || data.filename?.endsWith('.png') || data.filename?.endsWith('.webp');
                    const isAudio = data.filename?.endsWith('.mp3') || data.filename?.endsWith('.ogg');

                    if (isImage) {
                        await sock.sendMessage(jid, { image: buffer, caption: `✅ Downloaded: ${data.filename || 'Media'}` }, { quoted: msg });
                    } else if (isAudio) {
                        await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', fileName: data.filename || 'Audio.mp3' }, { quoted: msg });
                    } else {
                        // Default to Video
                        await sock.sendMessage(jid, { video: buffer, caption: `✅ Downloaded: ${data.filename || 'Video'}` }, { quoted: msg });
                    }
                } else {
                    sendWithLogo(`❌ Unexpected status: ${data.status}`);
                }

            } catch (e) {
                console.error('[TITAN] Download Error:', e.response?.data || e.message);
                sendWithLogo('❌ Failed to download. The link might be private, invalid, or the service is down.');
            }
            break;

        case 'setprefix':
            if (args[0]) await sendWithLogo(`❌ Prefix change requires DB. Using default: ${config.prefix}`);
            break;

        default:
            break;
    }
}

// Start time for uptime
const startTime = Date.now();

module.exports = { handleCommand, handleAntiLink };
