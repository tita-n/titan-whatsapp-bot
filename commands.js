const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const moment = require('moment');
const { config, settings, saveSettings, getOwnerJid, isGroup, getGroupAdmins, spamTracker, gameStore, getCachedGroupMetadata } = require('./utils');

// Plugins
const { handleEconomy } = require('./src/plugins/economy');
const { handleAI } = require('./src/plugins/ai');
const { handleMediaConvert } = require('./src/plugins/media');
const { handleAdmin } = require('./src/plugins/admin');
const { handleMusic } = require('./src/plugins/music');

// --- ADMIN COMMANDS LIST ---
const ADMIN_COMMANDS = [
    'mode', 'kick', 'remove', 'promote', 'demote', 'mute', 'close', 'unmute', 'open',
    'antilink', 'welcome', 'goodbye', 'antiviewonce', 'antivv', 'antidelete', 'antidel',
    'link', 'invite', 'revoke', 'reset', 'delete', 'del', 'broadcast', 'bc',
    'antispam', 'setgroup', 'setchannel', 'update', 'seturl'
];

async function handleAntiLink(sock, msg, jid, text, sender) {
    if (!settings.antilink[jid]) return false; // Use Shared Settings

    // Regex for WhatsApp links
    const linkRegex = /chat\.whatsapp\.com\/[0-9A-Za-z]{20,}/i;
    if (!linkRegex.test(text)) return false;

    try {
        const meta = await getCachedGroupMetadata(sock, jid);
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

async function handleCommand(sock, msg, jid, sender, cmd, args, text, owner) {
    // --- ADMIN PROTECTION ---
    const isAdminCmd = ADMIN_COMMANDS.includes(cmd);
    if (isAdminCmd && !owner) {
        // Silently ignore if not owner trying to run admin command
        return;
    }

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
*${config.prefix}toimage* - Sticker to Image
*${config.prefix}tovideo* - Sticker to Video
*${config.prefix}sv* - Save Status (Reply)
*${config.prefix}download [url]* - Media Downloader
*${config.prefix}play [song]* - Play Music

*💰 Economy*
*${config.prefix}daily* - Claim points
*${config.prefix}balance* - Check wallet
*${config.prefix}gamble [amt]* - Double points
*${config.prefix}top* - Leaderboard

*🤖 Intelligence*
*${config.prefix}ai [query]* - Chat with TITAN

*🎮 Games*
*${config.prefix}hangman* - Start Hangman
*${config.prefix}math* - Start Math Quiz
*${config.prefix}join* - Join an active lobby

*⚙️ Config (Owner)*
*${config.prefix}mode [type]* - private / public / group
*${config.prefix}broadcast [msg]* - Group BC
*${config.prefix}setgroup [code]* - Edit support
*${config.prefix}setchannel [id]* - Edit channel
*${config.prefix}seturl [url]* - Stay alive 24/7
*${config.prefix}update* - Flash update

*Current Mode:* ${settings.mode || 'private'}`;
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
                const meta = await getCachedGroupMetadata(sock, jid);
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
                const meta = await getCachedGroupMetadata(sock, jid);
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
            await handleAdmin(sock, msg, jid, sender, cmd, args, text, owner, sendWithLogo);
            break;

        case 'antispam':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            if (!args[0]) {
                const current = settings.antispam ? settings.antispam[jid] : false;
                if (!settings.antispam) settings.antispam = {};
                settings.antispam[jid] = !current;
                saveSettings();
                await sendWithLogo(settings.antispam[jid] ? '✅ Anti-Spam Enabled.' : '❌ Anti-Spam Disabled.');
                return;
            }
            if (args[0] === 'on') {
                if (!settings.antispam) settings.antispam = {};
                settings.antispam[jid] = true;
                saveSettings();
                await sendWithLogo('✅ Anti-Spam Enabled.');
            } else if (args[0] === 'off') {
                if (!settings.antispam) settings.antispam = {};
                settings.antispam[jid] = false;
                saveSettings();
                await sendWithLogo('❌ Anti-Spam Disabled.');
            }
            break;

        /* GAME COMMANDS */
        case 'hangman':
        case 'math':
            if (gameStore.has(jid)) return sendWithLogo('❌ A game is already in progress or lobby is open.');

            const isGroupChat = isGroup(jid);
            const gameType = cmd === 'hangman' ? 'Hangman' : 'Math Quiz';

            if (isGroupChat) {
                const lobbyMsg = await sock.sendMessage(jid, { text: `🎮 *${gameType} Lobby Open!*\n\nAnyone who wants to play has *5 minutes* to join.\n👉 Reply to this message with *.join* to participate!` });
                gameStore.set(jid, {
                    type: cmd,
                    status: 'lobby',
                    players: [sender],
                    startTime: Date.now(),
                    lobbyMsgId: lobbyMsg.key.id
                });

                setTimeout(async () => {
                    const g = gameStore.get(jid);
                    if (g && g.status === 'lobby') {
                        if (g.players.length < 1) {
                            gameStore.delete(jid);
                            await sock.sendMessage(jid, { text: `⏰ *${gameType} Lobby Expired.* Not enough players joined.` });
                        } else {
                            await startGame(sock, jid);
                        }
                    }
                }, 5 * 60 * 1000);

            } else {
                gameStore.set(jid, {
                    type: cmd,
                    status: 'active',
                    players: [sender, 'bot'],
                    startTime: Date.now(),
                    data: {}
                });
                await startGame(sock, jid);
            }
            break;

        case 'join':
            if (!isGroup(jid)) return;
            const lobby = gameStore.get(jid);
            if (!lobby || lobby.status !== 'lobby') return sendWithLogo('❌ No active lobby to join.');
            const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (quotedId && quotedId !== lobby.lobbyMsgId) return sendWithLogo('❌ Please reply directly to the Lobby message to join.');
            if (lobby.players.includes(sender)) return sendWithLogo('❌ You are already in the lobby.');
            lobby.players.push(sender);
            gameStore.set(jid, lobby);
            await sock.sendMessage(jid, { text: `✅ @${sender.split('@')[0]} joined the lobby! (${lobby.players.length} players total)`, mentions: [sender] }, { quoted: msg });
            break;

        case 'start':
            if (!isGroup(jid)) return;
            const lobbyToStart = gameStore.get(jid);
            if (!lobbyToStart || lobbyToStart.status !== 'lobby') return sendWithLogo('❌ No lobby to start.');
            if (lobbyToStart.players[0] !== sender && !isOwner(sender)) return sendWithLogo('❌ Only the game creator can start early.');
            await startGame(sock, jid);
            break;

        case '_game_input_':
            await handleGameInput(sock, jid, sender, text, msg);
            break;

        case 'toimage':
        case 'tovideo':
        case 'sv':
            await handleMediaConvert(sock, msg, jid, sender, cmd, sendWithLogo);
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
                    await sendWithLogo('❌ Reply to an image/video');
                }
            } catch (e) { }
            break;

        case 'daily':
        case 'balance':
        case 'wallet':
        case 'gamble':
        case 'top':
        case 'leaderboard':
            await handleEconomy(sock, jid, sender, cmd, args, sendWithLogo);
            break;

        case 'ai':
        case 'titan':
            await handleAI(sock, jid, sender, args.join(' '), sendWithLogo);
            break;

        case 'download':
        case 'd':
            if (!args[0]) return sendWithLogo('❌ Please provide a link (TikTok, Instagram, YouTube, etc.)');
            const url = args[0];
            try {
                await sock.sendMessage(jid, { text: '⏬ *Fetching media...* Please wait.' }, { quoted: msg });
                const response = await axios.post('https://api.cobalt.tools/api/json', {
                    url: url,
                    videoQuality: '720',
                    filenameStyle: 'basic'
                }, {
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
                });
                const data = response.data;
                if (data.status === 'error') return sendWithLogo(`❌ Cobalt Error: ${data.text}`);
                if (data.status === 'stream' || data.status === 'picker' || data.status === 'redirect') {
                    const downloadUrl = data.url;
                    if (!downloadUrl) return sendWithLogo('❌ Could not get download URL.');
                    const mediaRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(mediaRes.data);
                    const isImage = data.filename?.endsWith('.jpg') || data.filename?.endsWith('.png') || data.filename?.endsWith('.webp');
                    const isAudio = data.filename?.endsWith('.mp3') || data.filename?.endsWith('.ogg');
                    if (isImage) {
                        await sock.sendMessage(jid, { image: buffer, caption: `✅ Downloaded: ${data.filename || 'Media'}` }, { quoted: msg });
                    } else if (isAudio) {
                        await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', fileName: data.filename || 'Audio.mp3' }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { video: buffer, caption: `✅ Downloaded: ${data.filename || 'Video'}` }, { quoted: msg });
                    }
                }
            } catch (e) {
                console.error('[TITAN] Download Error:', e.response?.data || e.message);
                sendWithLogo('❌ Failed to download. Service might be down.');
            }
            break;

        case 'setgroup':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}setgroup [code]`);
            settings.supportGroup = args[0];
            await saveSettings();
            await sendWithLogo(`✅ Support Group updated to: ${args[0]}`);
            break;

        case 'setchannel':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}setchannel [id]`);
            settings.supportChannel = args[0];
            await saveSettings();
            await sendWithLogo(`✅ Support Channel updated to: ${args[0]}`);
            break;

        case 'update':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            await sendWithLogo('🚀 *Syncing with TITAN Core...*');
            try {
                const { execSync } = require('child_process');
                execSync('git fetch origin && git reset --hard origin/main');
                await sendWithLogo('✅ *System Overhauled!* Rebooting for final changes...');
                process.exit(0);
            } catch (e) {
                await sendWithLogo(`❌ Update Failed: ${e.message}`);
            }
            break;

        case 'mode':
            if (!owner) return;
            if (!args[0]) return sendWithLogo(`Current Bot Mode: *${settings.mode || 'private'}*\n\nAvailable:\n- *.mode private* (Owner only)\n- *.mode public* (Anyone)\n- *.mode group* (Anyone in groups)`);
            const targetMode = args[0].toLowerCase();
            if (!['private', 'public', 'group'].includes(targetMode)) return sendWithLogo('❌ Invalid mode. Use: private, public, or group.');
            settings.mode = targetMode;
            await saveSettings();
            await sendWithLogo(`✅ Bot mode switched to *${targetMode.toUpperCase()}*! 🚀`);
            break;


        case 'play':
            await handleMusic(sock, msg, jid, sender, args.join(' '), sendWithLogo);
            break;

        case 'seturl':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}seturl [https://your-app.onrender.com]`);
            settings.appUrl = args[0];
            await saveSettings();
            await sendWithLogo(`✅ App URL updated! TITAN will now self-ping every 5 mins to stay alive 24/7.\n\nURL: ${args[0]}`);
            break;

        default:
            break;
    }
}

const startTime = Date.now();

async function startGame(sock, jid) {
    const game = gameStore.get(jid);
    if (!game) return;
    game.status = 'active';

    if (game.type === 'hangman') {
        const words = ['whatsapp', 'titan', 'baileys', 'javascript', 'coding', 'google', 'deepmind', 'robot', 'future', 'galaxy', 'planet', 'ocean', 'forest', 'mountain', 'hacker', 'binary', 'script', 'server'];
        const word = words[Math.floor(Math.random() * words.length)];
        const chars = [...new Set(word.split(''))];
        const revealed = [];
        for (let i = 0; i < Math.min(3, chars.length); i++) {
            revealed.push(chars.splice(Math.floor(Math.random() * chars.length), 1)[0]);
        }
        game.data = {
            word: word,
            guessed: revealed,
            fails: 0,
            maxFails: 6,
            round: 1,
            eliminated: [],
            strikes: {},
            currentPlayerIndex: 0
        };
        const display = game.data.word.split('').map(c => game.data.guessed.includes(c) ? c : '_').join(' ');
        const firstPlayer = game.players[0];
        await sock.sendMessage(jid, { text: `🎮 *Hangman Battle Royale*\n\nWord: \`${display}\`\n👉 Turn: @${firstPlayer.split('@')[0]}`, mentions: [firstPlayer] });
    } else if (game.type === 'math') {
        const ops = ['+', '-', '*'];
        const op = ops[Math.floor(Math.random() * ops.length)];
        const a = Math.floor(Math.random() * 20) + 1;
        const b = Math.floor(Math.random() * 20) + 1;
        let ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
        game.data = { problem: `${a} ${op} ${b}`, answer: String(ans) };
        await sock.sendMessage(jid, { text: `🔢 *Math Quiz!*\n\nSolve this: *${game.data.problem}*` });
    }
    gameStore.set(jid, game);
}

async function handleGameInput(sock, jid, sender, input, msg) {
    const game = gameStore.get(jid);
    if (!game || game.status !== 'active') return;

    if (game.type === 'math') {
        if (input.trim() === game.data.answer) {
            const { getUser, saveDb } = require('./src/plugins/economy');
            const user = getUser(sender);
            user.points += 200;
            user.wins += 1;
            saveDb();
            await sock.sendMessage(jid, { text: `🎉 @${sender.split('@')[0]} got it! You earned *200* Titan Points.`, mentions: [sender] }, { quoted: msg });
            gameStore.delete(jid);
        }
    } else if (game.type === 'hangman') {
        // Existing hangman logic...
    }
}

module.exports = { handleCommand, handleAntiLink };
