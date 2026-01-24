const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const moment = require('moment');
const fs = require('fs-extra');
const axios = require('axios');
const { config, settings, saveSettings, getOwnerJid, isGroup, getGroupAdmins, spamTracker, gameStore, getCachedGroupMetadata } = require('./utils');

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
*${config.prefix}download [url]* - Sc-Media Downloader
*${config.prefix}d [url]* - Shortcut for download

*🎮 Games*
*${config.prefix}hangman* - Start Hangman Lobby
*${config.prefix}math* - Start Math Quiz Lobby
*${config.prefix}join* - Join an active lobby`;
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
                // LOBBY SYSTEM (5 MINS)
                const lobbyMsg = await sock.sendMessage(jid, { text: `🎮 *${gameType} Lobby Open!*\n\nAnyone who wants to play has *5 minutes* to join.\n👉 Reply to this message with *.join* to participate!` });

                gameStore.set(jid, {
                    type: cmd,
                    status: 'lobby',
                    players: [sender], // Creator joins automatically
                    startTime: Date.now(),
                    lobbyMsgId: lobbyMsg.key.id
                });

                // Auto-start after 5 mins
                setTimeout(async () => {
                    const g = gameStore.get(jid);
                    if (g && g.status === 'lobby') {
                        if (g.players.length < 1) { // Normal 2+ but user asked for participation, allow self-play if lonely? 1 is fine for testing
                            gameStore.delete(jid);
                            await sock.sendMessage(jid, { text: `⏰ *${gameType} Lobby Expired.* Not enough players joined.` });
                        } else {
                            await startGame(sock, jid);
                        }
                    }
                }, 5 * 60 * 1000);

            } else {
                // DM SYSTEM (Start Immediately)
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

            // Check if replying to the correct lobby message
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
            // Logic for guesses/answers
            await handleGameInput(sock, jid, sender, text, msg);
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

        case 'setgroup':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}setgroup [code]\nExample: ${config.prefix}setgroup Fes6TfTWL7vGxb92wbO2oj`);
            settings.supportGroup = args[0];
            await sendWithLogo(`✅ Support Group updated to: ${args[0]}`);
            break;

        case 'setchannel':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}setchannel [id]\nExample: ${config.prefix}setchannel 0029VbAfo9dJ3jv3zgM3KQ3E`);
            settings.supportChannel = args[0];
            await sendWithLogo(`✅ Support Channel updated to: ${args[0]}`);
            break;

        case 'update':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            await sendWithLogo('⏳ *Checking for updates...*');
            try {
                const { execSync } = require('child_process');
                const stdout = execSync('git pull origin main').toString();
                if (stdout.includes('Already up to date')) {
                    await sendWithLogo('✅ TITAN is already running the latest version.');
                } else {
                    await sendWithLogo('🚀 *Update Pulled!* Restarting... (Session is safe in Env)');
                    process.exit(0); // Render will auto-restart
                }
            } catch (e) {
                await sendWithLogo(`❌ Update Failed: ${e.message}`);
            }
            break;

        case 'play':
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}play [song name]`);
            const query = args.join(' ');
            try {
                await sock.sendMessage(jid, { text: `🎵 *Searching:* \`${query}\`...` }, { quoted: msg });
                const yts = require('yt-search');
                const search = await yts(query);
                const video = search.videos[0];
                if (!video) return sendWithLogo('❌ No results found.');

                await sock.sendMessage(jid, { text: `⏬ *Downloading:* \`${video.title}\`...` }, { quoted: msg });

                // For "Free/Small" servers, we use an external API to avoid memory/binary issues
                const axios = require('axios');
                const dlResponse = await axios.get(`https://api.vreden.my.id/api/ytmp3?url=${video.url}`);
                if (dlResponse.data.status !== 200) throw new Error('Download API error');

                const buffer = await axios.get(dlResponse.data.result.download.url, { responseType: 'arraybuffer' });

                await sock.sendMessage(jid, {
                    audio: Buffer.from(buffer.data),
                    mimetype: 'audio/mpeg',
                    ptt: false,
                    fileName: `${video.title}.mp3`,
                    contextInfo: {
                        externalAdReply: {
                            title: video.title,
                            body: video.author.name,
                            mediaType: 2,
                            thumbnailUrl: video.thumbnail,
                            sourceUrl: video.url
                        }
                    }
                }, { quoted: msg });
            } catch (e) {
                console.error('[TITAN] Play Error:', e);
                await sendWithLogo('❌ Failed to play music. Try again later.');
            }
            break;

        default:
            break;
    }
}

// Start time for uptime
const startTime = Date.now();

// --- GAME HELPERS ---

async function startGame(sock, jid) {
    const game = gameStore.get(jid);
    if (!game) return;

    game.status = 'active';

    if (game.type === 'hangman') {
        const words = ['whatsapp', 'titan', 'baileys', 'javascript', 'coding', 'google', 'deepmind', 'robot', 'future', 'galaxy', 'planet', 'ocean', 'forest', 'mountain', 'hacker', 'binary', 'script', 'server'];
        const word = words[Math.floor(Math.random() * words.length)];

        // Reveal 3 random distinct letters
        const chars = [...new Set(word.split(''))];
        const revealed = [];
        for (let i = 0; i < Math.min(3, chars.length); i++) {
            const idx = Math.floor(Math.random() * chars.length);
            revealed.push(chars.splice(idx, 1)[0]);
        }

        game.data = {
            word: word,
            guessed: revealed,
            fails: 0,
            maxFails: 6,
            round: 1,
            eliminated: [],
            strikes: {},
            currentPlayerIndex: 0 // Track whose turn it is
        };
        const display = game.data.word.split('').map(c => game.data.guessed.includes(c) ? c : '_').join(' ');
        const firstPlayer = game.players[0];
        await sock.sendMessage(jid, { text: `🎮 *Hangman Battle Royale: Round 1*\n\nWord: \`${display}\`\nMax Fails: 6\n\n👉 Turn: @${firstPlayer.split('@')[0]}\n*Only the current player can guess!*`, mentions: [firstPlayer] });
    } else if (game.type === 'math') {
        const problem = generateMathProblem();
        game.data = {
            problem: problem.text,
            answer: problem.answer
        };
        await sock.sendMessage(jid, { text: `🔢 *Math Quiz Started!*\n\nSolve this: *${game.data.problem}*\n\n*First one to answer correctly wins!*` });
    }
    gameStore.set(jid, game);
}

function generateMathProblem() {
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    let text = `${a} ${op} ${b}`;
    let answer;
    if (op === '+') answer = a + b;
    else if (op === '-') answer = a - b;
    else answer = a * b;
    return { text, answer: String(answer) };
}

async function processHangmanWin(sock, jid, game, sender) {
    game.data.round++;
    game.data.currentPlayerIndex = 0; // Reset turn for new round
    if (game.data.round > 5 || game.players.filter(p => !game.data.eliminated.includes(p)).length <= 1) {
        const finalists = game.players.filter(p => !game.data.eliminated.includes(p));
        const winnerText = finalists.length > 0 ? `@${finalists[0].split('@')[0]}` : 'No one';
        await sock.sendMessage(jid, { text: `🎉 *Game Over!* Winner: *${winnerText}*`, mentions: finalists });
        gameStore.delete(jid);
    } else {
        const difficulty = game.data.round === 2 ? 4 : 2;
        const words = ['coding', 'javascript', 'whatsapp', 'robot', 'galaxy', 'future'];
        const newWord = words[Math.floor(Math.random() * words.length)];
        const chars = [...new Set(newWord.split(''))];
        const revealed = [];
        for (let i = 0; i < Math.min(2, chars.length); i++) {
            const idx = Math.floor(Math.random() * chars.length);
            revealed.push(chars.splice(idx, 1)[0]);
        }
        game.data.word = newWord;
        game.data.guessed = revealed;
        game.data.fails = 0;
        game.data.maxFails = difficulty;
        game.data.strikes = {};
        const newDisplay = game.data.word.split('').map(c => game.data.guessed.includes(c) ? c : '_').join(' ');
        const nextP = game.players[0];
        await sock.sendMessage(jid, { text: `✅ Correct! Round ${game.data.round} begins.\n🔥 Difficulty: ${difficulty} fails max.\n\nNext Word: \`${newDisplay}\`\n👉 Turn: @${nextP.split('@')[0]}`, mentions: [nextP] });
        gameStore.set(jid, game);
    }
}

async function checkHangmanGameOver(sock, jid, game) {
    if (game.data.fails >= game.data.maxFails) {
        await sock.sendMessage(jid, { text: `💀 *Round Failed!* The word was: *${game.data.word}*` });
        game.data.round++;
        if (game.data.round > 5 || game.players.filter(p => !game.data.eliminated.includes(p)).length <= 1) {
            gameStore.delete(jid);
        } else {
            await startGame(sock, jid);
        }
    } else {
        const display = game.data.word.split('').map(c => game.data.guessed.includes(c) ? c : '_').join(' ');
        const nextIdx = (game.data.currentPlayerIndex + 1) % game.players.length;
        // Skip eliminated (recursive check or simple loop)
        let found = false;
        let finalIdx = nextIdx;
        for (let i = 0; i < game.players.length; i++) {
            let checkIdx = (nextIdx + i) % game.players.length;
            if (!game.data.eliminated.includes(game.players[checkIdx])) {
                finalIdx = checkIdx;
                found = true;
                break;
            }
        }
        game.data.currentPlayerIndex = finalIdx;
        const nextP = game.players[finalIdx];
        await sock.sendMessage(jid, { text: `Word: \`${display}\`\nFails: ${game.data.fails}/${game.data.maxFails}\n\n👉 Turn: @${nextP.split('@')[0]}`, mentions: [nextP] });
        gameStore.set(jid, game);
    }
}

async function handleGameInput(sock, jid, sender, input, msg) {
    const game = gameStore.get(jid);
    if (!game || game.status !== 'active') return;

    const isPlayer = game.players.includes(sender) || game.players.includes('bot');
    if (!isPlayer) return;

    if (game.type === 'hangman') {
        const currentPlayer = game.players[game.data.currentPlayerIndex];
        if (sender !== currentPlayer) return sock.sendMessage(jid, { text: `⚠️ It's not your turn! Turn: @${currentPlayer.split('@')[0]}`, mentions: [currentPlayer] }, { quoted: msg });

        if (game.data.eliminated.includes(sender)) return sock.sendMessage(jid, { text: '❌ You are eliminated from this game!' }, { quoted: msg });

        const inputRaw = input.toLowerCase().trim();
        if (!inputRaw || !/[a-z]/.test(inputRaw)) return;

        // --- WHOLE WORD GUESS ---
        if (inputRaw.length > 1) {
            if (inputRaw === game.data.word) {
                game.data.guessed = game.data.word.split('');
                await sock.sendMessage(jid, { text: `🎯 *Incredible!* @${sender.split('@')[0]} guessed the whole word: *${game.data.word}*`, mentions: [sender] });
                return await processHangmanWin(sock, jid, game, sender);
            } else {
                game.data.fails += 2;
                game.data.strikes[sender] = (game.data.strikes[sender] || 0) + 1;
                await sock.sendMessage(jid, { text: `❌ Wrong word! *${inputRaw}* is not it.\nPenalty: +2 Fails.`, mentions: [sender] });
                if (game.data.strikes[sender] >= 3) {
                    game.data.eliminated.push(sender);
                    await sock.sendMessage(jid, { text: `💀 @${sender.split('@')[0]} has been eliminated!`, mentions: [sender] });
                }
                return await checkHangmanGameOver(sock, jid, game);
            }
        }

        // --- SINGLE LETTER GUESS ---
        const char = inputRaw;

        if (game.data.guessed.includes(char)) return; // Already guessed

        if (game.data.word.includes(char)) {
            // Hit
            game.data.guessed.push(char);
            const won = game.data.word.split('').every(c => game.data.guessed.includes(c));
            const display = game.data.word.split('').map(c => game.data.guessed.includes(c) ? c : '_').join(' ');

            if (won) {
                return await processHangmanWin(sock, jid, game, sender);
            } else {
                const display = game.data.word.split('').map(c => game.data.guessed.includes(c) ? c : '_').join(' ');
                await sock.sendMessage(jid, { text: `✅ Nice! \`${char}\` is correct.\n\nWord: \`${display}\`\nFails: ${game.data.fails}/${game.data.maxFails}` });
                gameStore.set(jid, game);
            }
        } else if (char.length === 1) {
            // Miss
            game.data.fails++;
            game.data.guessed.push(char);
            game.data.strikes[sender] = (game.data.strikes[sender] || 0) + 1;

            if (game.data.strikes[sender] >= 3) {
                game.data.eliminated.push(sender);
                await sock.sendMessage(jid, { text: `💀 @${sender.split('@')[0]} has been eliminated!`, mentions: [sender] });
            }

            return await checkHangmanGameOver(sock, jid, game);
        }
    } else if (game.type === 'math') {
        const ans = input.trim();
        if (ans === game.data.answer) {
            await sock.sendMessage(jid, { text: `🎉 *Correct!* @${sender.split('@')[0]} got it right: *${game.data.answer}*`, mentions: [sender] });
            gameStore.delete(jid);
        }
    }
}

module.exports = { handleCommand, handleAntiLink };
