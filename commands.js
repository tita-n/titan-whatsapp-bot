const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const moment = require('moment');
const { config, settings, saveSettings, getOwnerJid, isGroup, isChannel, getGroupAdmins, spamTracker, gameStore, getCachedGroupMetadata, isViewOnceStub, extractViewOnceContent, detectViewOnceType, isBotAdmin, getGroupSettings, updateGroupSettings, addStrike, getStrikes, clearStrikes, exportSessionBundle } = require('./utils');

// Plugins
const { handleEconomy, getUser, saveDb } = require('./src/plugins/economy');
const { handleAI } = require('./src/plugins/ai');
const { handleMediaConvert } = require('./src/plugins/media');
const { handleAdmin } = require('./src/plugins/admin');
const { handleMusic } = require('./src/plugins/music');
const { handleTools } = require('./src/plugins/tools');
const { handleTitanAI } = require('./src/plugins/titan_ai');
const { handleChess, isChessMove, makeChessMove } = require('./src/plugins/chess');
const { handleAudio } = require('./src/plugins/audio');
const { handleGames } = require('./src/plugins/games');

const ADMIN_COMMANDS = [
    'mode', 'kick', 'remove', 'promote', 'demote', 'mute', 'close', 'unmute', 'open',
    'antilink', 'welcome', 'goodbye', 'antivviewonce', 'antivv', 'antidelete', 'antidel',
    'link', 'invite', 'revoke', 'reset', 'delete', 'del', 'broadcast', 'bc', 'block', 'unblock',
    'warn', 'warns', 'resetwarns', 'poll',
    'antispam', 'setgroup', 'setchannel', 'update', 'seturl', 'owner', 'restart', 'reset-session', 'resetsession', 'session', 'getsession'
];

// ============================================================
// ANTI-LINK HANDLER - Multiple modes (delete/warn/kick)
// ============================================================

// Comprehensive link regex - detects WhatsApp links, URLs, shorteners
const LINK_PATTERNS = [
    /https?:\/\/(chat\.whatsapp\.com|wa\.me|whatsapp\.com)\/[^\s]+/i,
    /https?:\/\/[^\s]+\.[^\s]{2,}(\/[^\s]*)?/i,
    /https?:\/\/[^\s]+\.[^\s]{2,}/i,
    /(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|youtu\.be|instagram\.com|twitter\.com)\/[^\s]+/i
];

function detectLink(text) {
    if (!text) return false;
    for (const pattern of LINK_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) return true;
    }
    return false;
}

async function handleAntiLink(sock, msg, jid, text, sender) {
    // Check global toggle first
    if (!settings.antilink) return false;

    // Get per-group settings
    const gs = getGroupSettings(jid);
    
    // Check if antilink is enabled for this group
    if (!gs.antilink || gs.antilink.mode === 'off') {
        return false;
    }

    // Skip if no text (media-only messages without caption)
    if (!text || text.trim() === '') {
        return false;
    }

    // Check for links
    if (!detectLink(text)) {
        return false;
    }

    console.log(`[TITAN ANTI-LINK] Link detected from ${sender} in ${jid}, mode: ${gs.antilink.mode}`);

    try {
        // Check if sender is admin - bypass
        const meta = await getCachedGroupMetadata(sock, jid);
       const admins = getGroupAdmins(meta?.participants || []);

// Normalize JIDs to strip device suffix before comparing
const normalizedSender = sender.split(':')[0] + '@s.whatsapp.net';
const normalizedAdmins = admins.map(a => a.split(':')[0] + '@s.whatsapp.net');

if (normalizedAdmins.includes(normalizedSender)) {
            console.log(`[TITAN ANTI-LINK] User is admin, bypassing`);
            return false;
        }

        // Check if bot is admin
        const botIsAdmin = await isBotAdmin(sock, jid);
        if (!botIsAdmin) {
            console.log('[TITAN ANTI-LINK] Bot is not admin, cannot act');
            return false;
        }

        const mode = gs.antilink.mode;
        
        // DELETE - Just delete the message
        if (mode === 'delete') {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
                console.log('[TITAN ANTI-LINK] Link message deleted');
            } catch (e) {
                console.error('[TITAN ANTI-LINK] Delete failed:', e.message);
            }
            return true;
        }
        
        // WARN - Delete + warn + track strikes
        if (mode === 'warn') {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
            } catch (e) {
                console.error('[TITAN ANTI-LINK] Delete failed:', e.message);
            }
            
            const strikeCount = addStrike(jid, sender);
            const maxStrikes = 3;
            
            await sock.sendMessage(jid, { 
                text: `⚠️ @${sender.split('@')[0]}, links are not allowed!\n\n🚫 Strike ${strikeCount}/${maxStrikes}`,
                mentions: [sender]
            });
            
            console.log(`[TITAN ANTI-LINK] User warned, strikes: ${strikeCount}`);
            
            // Kick if 3 strikes
            if (strikeCount >= maxStrikes) {
                try {
                    await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                    await sock.sendMessage(jid, { 
                        text: `🚫 @${sender.split('@')[0]} was removed for repeated link violations (3 strikes)`,
                        mentions: [sender]
                    });
                    clearStrikes(jid, sender);
                    console.log('[TITAN ANTI-LINK] User kicked due to 3 strikes');
                } catch (e) {
                    console.error('[TITAN ANTI-LINK] Kick failed:', e.message);
                }
            }
            return true;
        }
        
        // KICK - Delete + immediately kick
        if (mode === 'kick') {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
            } catch (e) {
                console.error('[TITAN ANTI-LINK] Delete failed:', e.message);
            }
            
            try {
                await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                await sock.sendMessage(jid, { 
                    text: `🚫 @${sender.split('@')[0]} was removed for posting links`,
                    mentions: [sender]
                });
                console.log('[TITAN ANTI-LINK] User kicked');
            } catch (e) {
                console.error('[TITAN ANTI-LINK] Kick failed:', e.message);
            }
            return true;
        }

        return false;
    } catch (e) {
        console.error('[TITAN ANTI-LINK] Error:', e.message);
        return false;
    }
}

async function handleCommand(sock, msg, jid, sender, cmd, args, text, owner, cmdStart = Date.now()) {
    const isGroupChat = isGroup(jid);

    const sendWithLogo = async (text, mentions = [], lite = true) => {
        const header = `╭━━━━━━━━━━━━━━╮\n      🛡️  *T I T A N*\n╰━━━━━━━━━━━━━━╯`;
        const elapsedMs = Date.now() - cmdStart;
        const footer = `\n\n⚡ *Latency:* ${elapsedMs}ms\n🛡️ *Elite Edition*`;
        const caption = `${header}\n\n${text}${footer}`;

        // Turbo-Duct Optimization: Skip thumbnail for newsletters or when 'lite' is requested
        const isChan = isChannel(jid);
        const useAdReply = !isChan; // Channels often glitch with adReply thumbnails

        const contextInfo = useAdReply ? {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: config.supportChannel,
                newsletterName: 'TITAN ELITE',
                serverMessageId: 1
            },
            externalAdReply: {
                title: '🛡️ TITAN | OFFICIAL',
                body: 'Turbo-Duct Speed 🏎️',
                thumbnail: config.logoBuffer,
                sourceUrl: `https://whatsapp.com/channel/${config.supportChannel.split('@')[0]}`,
                mediaType: 1,
                renderLargerThumbnail: false
            }
        } : {};

        // ATOMIC SPEED PATH: Send pure text with externalAdReply metadata for lightning speed (< 100ms)!
        await sock.sendMessage(jid, { text: caption, mentions, contextInfo });
    };

    // --- ADMIN PROTECTION ---
    const isAdminCmd = ADMIN_COMMANDS.includes(cmd);
    if (isAdminCmd && !owner) {
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

    switch (cmd) {
        case 'menu':
        case 'help':
            // Get per-group settings for menu display
            const gs = isGroup(jid) ? getGroupSettings(jid) : null;
            const antilinkStatus = gs?.antilink?.mode || 'off';
            
            const menuText = `*🤖 TITAN COMMAND CENTER*
Prefix: *${config.prefix}*

*🛠️ Utility*
• *${config.prefix}ping* - Check speed & latency
• *${config.prefix}status* - System uptime
• *${config.prefix}menu* - Show command list
• *${config.prefix}vv* / *${config.prefix}vv2* - Retrieve ViewOnce
• *${config.prefix}antivv* - Auto-capture ViewOnce media
• *${config.prefix}titan* - About the developer 🔥
• *${config.prefix}jid* - Get Chat/User JID
• *${config.prefix}pp* - Get Profile Picture in HD
• *${config.prefix}link* / *${config.prefix}revoke* - Group link management

*🎵 Audio Effects & Voice*
• *${config.prefix}tts [lang] [text]* - Text-To-Speech voice note
• *${config.prefix}bass* - Boost audio bass
• *${config.prefix}robot* - Robot voice effect
• *${config.prefix}nightcore* - High pitch & fast tempo
• *${config.prefix}slow* - Slowed & reverb effect
• *${config.prefix}reverse* - Play audio backwards

*🔍 Search & Information*
• *${config.prefix}weather [city]* - Live weather forecast
• *${config.prefix}wiki [query]* - Wikipedia search
• *${config.prefix}lyrics [song]* - Song lyrics finder
• *${config.prefix}movie [title]* - IMDb movie details & poster

*📢 Group & Moderation*
• *${config.prefix}tagall [msg]* - Tag all group members
• *${config.prefix}hidetag [msg]* - Invisible tagall
• *${config.prefix}welcome [on/off/set]* - Auto welcome message
• *${config.prefix}goodbye [on/off/set]* - Auto goodbye message
• *${config.prefix}antilink [off/delete/warn/kick]* - Anti-link guard
• *${config.prefix}warn @user* - Issue warning strike (3 = kick)
• *${config.prefix}warns @user* - Check user warning count
• *${config.prefix}resetwarns @user* - Clear warnings for user
• *${config.prefix}poll Q | Opt1 | Opt2* - Send WhatsApp poll

*👮‍♂️ Admin Controls*
• *${config.prefix}kick* / *${config.prefix}promote* / *${config.prefix}demote*
• *${config.prefix}mute* / *${config.prefix}unmute*
• *${config.prefix}delete* - Delete message
• *${config.prefix}block* / *${config.prefix}unblock* - Block user

*🎨 Media & Stickers*
• *${config.prefix}sticker* / *${config.prefix}s* - Image/Video to Sticker
• *${config.prefix}take [pack|author]* - Rename sticker author
• *${config.prefix}toimage* / *${config.prefix}tovideo* - Convert sticker
• *${config.prefix}attp [text]* - Animated text sticker
• *${config.prefix}triggered* / *${config.prefix}wasted* - Image filters
• *${config.prefix}sv* - Save status media
• *${config.prefix}dl [link]* - Universal Downloader (IG/TT/YT/X)
• *${config.prefix}play [song]* - YouTube music player

*💰 Economy & Wallet*
• *${config.prefix}daily* - Claim daily points
• *${config.prefix}balance* - Check wallet & score
• *${config.prefix}gamble [amt]* - Double points
• *${config.prefix}top* - Global leaderboard

*🤖 Intelligence*
• *${config.prefix}ai [prompt]* - Chat with TITAN AI
• *${config.prefix}tr [text]* - Instant Translation
• *${config.prefix}imagine [prompt]* - AI Image Visualizer
• *${config.prefix}roast [target]* - Brutal AI Roast
• *${config.prefix}memory* - AI Context Cache

*🧰 Tools & Productivity*
• *${config.prefix}afk [reason]* - Set Away From Keyboard status
• *${config.prefix}qr [text]* - Generate QR Code
• *${config.prefix}short [url]* - Shorten link
• *${config.prefix}carbon [code]* - Code snippet image
• *${config.prefix}meme [top|bottom]* - Drake meme generator
• *${config.prefix}todo* - Personal To-Do list
• *${config.prefix}remind [task] in [time]* - Set reminder

*🎮 Games & Social*
• *${config.prefix}ship @user1 @user2* - Love compatibility score
• *${config.prefix}truth* / *${config.prefix}dare* - Truth or Dare prompts
• *${config.prefix}flip* - Coin flip (Heads/Tails)
• *${config.prefix}roll* - 6-sided dice roll
• *${config.prefix}chess* - Play chess vs Bot or Player
• *${config.prefix}hangman* - Start Hangman game
• *${config.prefix}math* - Solve Math Quiz

*⚙️ Config & Owner*
• *${config.prefix}mode* - Access mode (private/public/group)
• *${config.prefix}session* - Export Base64 SESSION_ID bundle
• *${config.prefix}update* / *${config.prefix}restart* - Flash update & reboot

*🛡️ Global Shields*
• Antilink: ${settings.antilink ? '✅' : '❌'}
• Antidelete: ${settings.antidelete ? '✅' : '❌'}
• Welcome: ${settings.welcome ? '✅' : '❌'}
• Goodbye: ${settings.goodbye ? '✅' : '❌'}
• Anti-VV: ${settings.antivviewonce ? '✅' : '❌'}
• Anticall: ${settings.anticall ? '✅' : '❌'}
• Antispam: ${settings.antispam ? '✅' : '❌'}

*Current Mode:* ${settings.mode || 'private'}`;
            await sendWithLogo(menuText);
            break;

        case 'status':
            await sendWithLogo(`Bot active.\nUptime: ${moment.duration(Date.now() - startTime).humanize()}`);
            break;

        case 'ping': {
            const speedMs = Date.now() - cmdStart;
            await sendWithLogo(`🏓 *PONG!*

⚡ *Execution Speed:* ${speedMs}ms
🛡️ *Status:* Critical Max
🚀 *Engine:* Quantum Duct`);
            break;
        }

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
            
            const gsAnti = getGroupSettings(jid);
            
            if (!args[0]) {
                const currentMode = gsAnti.antilink?.mode || 'off';
                await sendWithLogo(`Current: *${currentMode.toUpperCase()}*\n\nModes:\n• \`off\` - Disabled\n• \`delete\` - Delete link only\n• \`warn\` - Warn + 3 strikes = kick\n• \`kick\` - Delete + kick immediately`);
                return;
            }
            
            const mode = args[0].toLowerCase();
            const validModes = ['off', 'delete', 'warn', 'kick'];
            
            if (!validModes.includes(mode)) {
                await sendWithLogo(`❌ Invalid mode: ${args[0]}\n\nValid modes:\n• \`off\` - Disabled\n• \`delete\` - Delete link only\n• \`warn\` - Warn + 3 strikes = kick\n• \`kick\` - Delete + kick immediately`);
                return;
            }
            
            // Check if bot is admin before enabling
            if (mode !== 'off') {
                const botAdmin = await isBotAdmin(sock, jid);
                if (!botAdmin) {
                    await sendWithLogo('❌ Bot needs to be admin to use antilink!\n\nMake bot admin first, then try again.');
                    return;
                }
            }
            
            gsAnti.antilink = { mode };
            settings.antilink = mode !== 'off' || Object.values(groupSettings).some(gs => gs.antilink?.mode && gs.antilink.mode !== 'off');
            saveSettings();
            await updateGroupSettings(jid, 'antilink', gsAnti.antilink);
            
            const modeDesc = {
                'off': 'Disabled',
                'delete': 'Delete link only',
                'warn': 'Warn + 3 strikes = kick',
                'kick': 'Delete + kick immediately'
            };
            
            await sendWithLogo(`✅ Antilink set to: *${mode.toUpperCase()}*\n\n${modeDesc[mode]}`);
            console.log(`[TITAN] Antilink set to ${mode} for group ${jid}`);
            break;

        case 'welcome':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            
            const gsWelcome = getGroupSettings(jid);
            
            if (!args[0]) {
                // Toggle
                gsWelcome.welcome.enabled = !gsWelcome.welcome.enabled;
                await updateGroupSettings(jid, 'welcome', gsWelcome.welcome);
                await sendWithLogo(gsWelcome.welcome.enabled ? '✅ Welcome message Enabled for this group.' : '❌ Welcome message Disabled for this group.');
                return;
            }
            
            if (args[0] === 'on') {
                gsWelcome.welcome.enabled = true;
                gsWelcome.welcome.text = null;
                await updateGroupSettings(jid, 'welcome', gsWelcome.welcome);
                await sendWithLogo('✅ Welcome message Enabled.\n\nUse `.welcome set <message>` to customize.');
            } else if (args[0] === 'off') {
                gsWelcome.welcome.enabled = false;
                await updateGroupSettings(jid, 'welcome', gsWelcome.welcome);
                await sendWithLogo('❌ Welcome message Disabled for this group.');
            } else if (args[0] === 'set' && args.slice(1).length > 0) {
                const customText = args.slice(1).join(' ');
                gsWelcome.welcome.enabled = true;
                gsWelcome.welcome.text = customText;
                await updateGroupSettings(jid, 'welcome', gsWelcome.welcome);
                await sendWithLogo(`✅ Welcome message updated!\n\nPreview:\n${customText.replace(/{user}/g, 'User').replace(/{group}/g, jid.split('@')[0]).replace(/{time}/g, new Date().toLocaleString())}\n\nPlaceholders: {user}, {group}, {time}`);
            } else {
                await sendWithLogo(`❌ Invalid usage!\n\nUsage:\n• \`${config.prefix}welcome on\` - Enable\n• \`${config.prefix}welcome off\` - Disable\n• \`${config.prefix}welcome set <message>\` - Custom message\n\nPlaceholders: {user}, {group}, {time}`);
            }
            break;

        case 'goodbye':
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');
            
            const gsGoodbye = getGroupSettings(jid);
            
            if (!args[0]) {
                // Toggle
                gsGoodbye.goodbye.enabled = !gsGoodbye.goodbye.enabled;
                await updateGroupSettings(jid, 'goodbye', gsGoodbye.goodbye);
                await sendWithLogo(gsGoodbye.goodbye.enabled ? '✅ Goodbye message Enabled for this group.' : '❌ Goodbye message Disabled for this group.');
                return;
            }
            
            if (args[0] === 'on') {
                gsGoodbye.goodbye.enabled = true;
                gsGoodbye.goodbye.text = null;
                await updateGroupSettings(jid, 'goodbye', gsGoodbye.goodbye);
                await sendWithLogo('✅ Goodbye message Enabled.\n\nUse \`.goodbye set <message>\` to customize.');
            } else if (args[0] === 'off') {
                gsGoodbye.goodbye.enabled = false;
                await updateGroupSettings(jid, 'goodbye', gsGoodbye.goodbye);
                await sendWithLogo('❌ Goodbye message Disabled for this group.');
            } else if (args[0] === 'set' && args.slice(1).length > 0) {
                const customText = args.slice(1).join(' ');
                gsGoodbye.goodbye.enabled = true;
                gsGoodbye.goodbye.text = customText;
                await updateGroupSettings(jid, 'goodbye', gsGoodbye.goodbye);
                await sendWithLogo(`✅ Goodbye message updated!\n\nPreview:\n${customText.replace(/{user}/g, 'User').replace(/{group}/g, jid.split('@')[0]).replace(/{time}/g, new Date().toLocaleString())}\n\nPlaceholders: {user}, {group}, {time}`);
            } else {
                await sendWithLogo(`❌ Invalid usage!\n\nUsage:\n• \`${config.prefix}goodbye on\` - Enable\n• \`${config.prefix}goodbye off\` - Disable\n• \`${config.prefix}goodbye set <message>\` - Custom message\n\nPlaceholders: {user}, {group}, {time}`);
            }
            break;

        /* NEW ANTI-FEATURES */
        /* ANTI-VIEWONCE COMMANDS - BULLET-PROOF IMPLEMENTATION */
        case 'vv':
        case 'vv2':
        case 'retrieve':
        case 'antivv':
            if (cmd === 'antivv') {
                // Handle toggle
                if (!owner) return;
                if (!args[0]) {
                    settings.antivviewonce = !settings.antivviewonce;
                    saveSettings();
                    await sendWithLogo(settings.antivviewonce ? '✅ *Anti-VV (Auto):* Silently captures view-once media to your DM.' : '❌ *Anti-VV (Auto):* Disabled.');
                    return;
                }
                if (args[0] === 'on') {
                    settings.antivviewonce = true;
                    saveSettings();
                    await sendWithLogo('✅ *Anti-VV (Auto):* Enabled. View-once media will be silently forwarded to your DM.');
                } else if (args[0] === 'off') {
                    settings.antivviewonce = false;
                    saveSettings();
                    await sendWithLogo('❌ *Anti-VV (Auto):* Disabled.');
                }
                break;
            }

            // VV Command - Extract view-once from replied message
            try {
                // PRIORITY 1: Check if user replied to a message (quoted)
                let targetMsg = null;
                let viewOnceContent = null;
                let voType = null;

                if (quoted) {
                    // User replied to a message - check quoted content
                    console.log('[TITAN VV] Checking quoted message structure...');
                    
                    // Check quoted message for view-once (handle ephemeral wrapper)
                    viewOnceContent = extractViewOnceContent(quoted);
                    if (viewOnceContent) {
                        voType = viewOnceContent.imageMessage ? 'image' : viewOnceContent.videoMessage ? 'video' : viewOnceContent.audioMessage ? 'audio' : null;
                        console.log(`[TITAN VV] Found in quoted: ${voType}`);
                    }
                    
                    // Also check if quoted itself is a stub (already viewed)
                    if (!viewOnceContent && quoted.messageStubType !== undefined) {
                        await sendWithLogo('❌ View once expired or already viewed. Cannot recover 😔');
                        break;
                    }
                }

                // PRIORITY 2: If no quoted content, check current message (for .vv2 or auto-detection)
                if (!viewOnceContent && cmd === 'vv2') {
                    viewOnceContent = extractViewOnceContent(msg.message);
                    if (viewOnceContent) {
                        voType = viewOnceContent.imageMessage ? 'image' : viewOnceContent.videoMessage ? 'video' : viewOnceContent.audioMessage ? 'audio' : null;
                        console.log(`[TITAN VV] Found in current message: ${voType}`);
                    }
                }

                // FAILURE: No view-once content found
                if (!viewOnceContent || !voType) {
                    // Check if it's a regular media (not view-once)
                    const isRegularMedia = quoted?.videoMessage || quoted?.imageMessage || quoted?.audioMessage;
                    const hasVOFlag = quoted?.videoMessage?.viewOnce || quoted?.imageMessage?.viewOnce || quoted?.audioMessage?.viewOnce;
                    
                    console.log('[TITAN VV] No view-once content. Quoted structure:', JSON.stringify(quoted || msg.message)?.slice(0, 500));
                    
                    if (isRegularMedia && !hasVOFlag) {
                        await sendWithLogo('❌ That\'s a regular video/image, not a ViewOnce!\n\nViewOnce = disappears after 1 view\nRegular media = stays in chat');
                    } else {
                        await sendWithLogo('❌ Reply to a ViewOnce message (image/video/audio) that hasn\'t been opened yet.\n\n⚠️ If you already viewed it - too late, WhatsApp deletes it from the server.');
                    }
                    break;
                }

                // Extract media message and download
                const mediaMsg = viewOnceContent.imageMessage || viewOnceContent.videoMessage || viewOnceContent.audioMessage;
                if (!mediaMsg) {
                    await sendWithLogo('❌ Media not detectable. Message might be corrupted.');
                    break;
                }

                // Download the media using downloadMediaMessage for better reliability
                let buffer;
                try {
                    buffer = await downloadMediaMessage(msg, 'buffer', {});
                } catch (dlErr) {
                    // Fallback to downloadContentFromMessage
                    console.log('[TITAN VV] downloadMediaMessage failed, trying downloadContentFromMessage...');
                    const stream = await downloadContentFromMessage(mediaMsg, voType);
                    buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                }

                if (!buffer || buffer.length === 0) {
                    await sendWithLogo('❌ View once expired or not detectable 😔\n\n💡 Tip: The sender must NOT have opened/viewed it yet.');
                    break;
                }

                // Determine destination: owner DM (.vv2) or sender DM (regular .vv)
                const targetJid = cmd === 'vv2' ? getOwnerJid() : sender;
                const caption = cmd === 'vv2' 
                    ? `🕵️ *Silent VV* (from @${sender.split('@')[0]})`
                    : '🙈 View Once saved by TITAN 🔥';

                // Send the recovered media
                if (voType === 'image') {
                    await sock.sendMessage(targetJid, { image: buffer, caption, mentions: [sender] });
                } else if (voType === 'video') {
                    await sock.sendMessage(targetJid, { video: buffer, caption, mentions: [sender] });
                } else if (voType === 'audio') {
                    await sock.sendMessage(targetJid, { audio: buffer, mimetype: 'audio/mp4', caption: caption.replace('🙈', '🎤') });
                }

                // Confirm to user if not silent mode
                if (cmd !== 'vv2') {
                    await sendWithLogo('✅ View-once media recovered and sent to your DM! 📥');
                }
                console.log(`[TITAN VV] Success! Sent ${voType} to ${targetJid}`);

            } catch (e) {
                console.error('[TITAN VV Error]:', e);
                await sendWithLogo(`❌ Failed to recover view-once: ${e.message}\n\n⚠️ Possible causes:\n• Message already viewed by sender/recipient\n• Media expired\n• WhatsApp server issue`);
            }
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

        case 'chess':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'accept':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'cancel':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'move':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'resign':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'draw':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'board':
        case 'rules':
            await handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo);
            break;

        case 'toimage':
        case 'tovideo':
        case 'sv':
        case 'take':
        case 'rename':
        case 'attp':
        case 'ttp':
        case 'wasted':
        case 'triggered':
            await handleMediaConvert(sock, msg, jid, sender, cmd, args, text, sendWithLogo);
            break;

        case 'tts':
        case 'bass':
        case 'robot':
        case 'nightcore':
        case 'slow':
        case 'reverse':
            await handleAudio(sock, msg, jid, sender, cmd, args, text, sendWithLogo);
            break;

        case 'ship':
        case 'love':
        case 'truth':
        case 'dare':
        case 'flip':
        case 'roll':
            await handleGames(sock, msg, jid, sender, cmd, args, text, sendWithLogo);
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

        case 'titan':
        case 'about':
        case 'dev':
        case 'whoami':
            const titanText = `🔥 *TITAN DEVELOPER SHOWCASE* 🔥

*Built by Titan* (@titan_griid) 🇳🇬

🚀 *About the Dev:*
Titan is a young, passionate JavaScript developer from Nigeria, dedicated to studying platforms and building high-performance tools. From complex WhatsApp automation to open-source utilities, Titan is always pushing the boundaries of what's possible in the JS ecosystem.

🛠️ *Projects:*
• *TITAN WhatsApp Bot:* The monster you're using right now.
• *autodate:* High-level date automation npm package.
  👉 [View on npm](https://www.npmjs.com/package/@tita-n/autodate)

💎 *Fun Facts:*
• Hustler energy at 100%. ⚡
• 100% Made in Naija. 🇳🇬
• Open to collaborations and high-level JS architecture.

📱 *Connect:*
• *X (Twitter):* [Follow @titan_griid](https://x.com/titan_griid)
• *GitHub:* [RestoTitan](https://github.com/tita-n)

---
_“Building the future, one line of code at a time.”_
---
*「 ${config.botName} 」*`;
            const titanImg = 'https://pbs.twimg.com/profile_images/2008309371575345152/7EQccipA.jpg';
            const titanContext = {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363402818387361@newsletter',
                    newsletterName: 'TITAN MODS V',
                    serverMessageId: 1
                }
            };
            try {
                await sock.sendMessage(jid, { image: { url: titanImg }, caption: titanText, contextInfo: titanContext });
            } catch (e) {
                await sock.sendMessage(jid, { text: titanText, contextInfo: titanContext });
            }
            break;

        case 'download':
        case 'dl':
        case 'd':
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}dl [link]`);
            const dlUrl = args[0];
            try {
                await sock.sendMessage(jid, { text: '⏬ *TITAN STEALTH:* Processing link...' }, { quoted: msg });

                let mediaUrl;
                const isYT = dlUrl.includes('youtube.com') || dlUrl.includes('youtu.be');

                if (isYT) {
                    const { downloadPrinceMp3 } = require('./src/plugins/princetech_api');
                    mediaUrl = await downloadPrinceMp3(dlUrl);
                } else {
                    const { cobaltDownload } = require('./src/plugins/media_api');
                    mediaUrl = await cobaltDownload(dlUrl);
                }

                if (!mediaUrl) return sendWithLogo('❌ Extraction failed. Link might be unsupported, private, or API is down.');

                const caption = `✅ *TITAN STEALTH OVERHAUL*\n🔗 *Source:* ${dlUrl}`;
                const isAudio = dlUrl.includes('music.youtube.com') || dlUrl.includes('spotify') || args.includes('--audio') || (isYT && !dlUrl.includes('shorts'));

                if (isAudio) {
                    await sock.sendMessage(jid, { audio: { url: mediaUrl }, mimetype: 'audio/mpeg', fileName: 'Titan_Audio.mp3' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { video: { url: mediaUrl }, caption }, { quoted: msg });
                }

            } catch (e) {
                console.error('[TITAN DOWNLOAD] Error:', e);
                await sendWithLogo('❌ Stealth API Error. Try again later.');
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
            await sendWithLogo('🔄 *TITAN NUCLEAR UPDATE INITIATED...*\n\nPulling code and forcing system reboot to apply changes.');
            try {
                const { execSync } = require('child_process');

                // 1. Wipe and re-init git
                execSync('rm -rf .git && git init');
                // 2. Point to source
                execSync(`git remote add origin ${config.repoUrl}`);
                // 3. Force Sync
                const output = execSync('git fetch origin && git reset --hard origin/main').toString();

                await sendWithLogo(`✅ *Sync Complete!*\n\n*Git Log:*\n\`\`\`${output}\`\`\`\n\n🚀 *Rebooting core to apply new features...*`);

                // Nuclear exit - Railway/Render will auto-restart the bot with new files
                setTimeout(() => {
                    process.exit(0);
                }, 3000);
            } catch (e) {
                console.error('[TITAN UPDATE] Error:', e);
                await sendWithLogo(`❌ Update Failed: ${e.message}`);
            }
            break;

        case 'restart':
            if (!owner) return;
            await sendWithLogo('🔄 *Rebooting core...* See you in 5 seconds.');
            process.exit(0);
            break;
        
        case 'reset-session':
        case 'resetsession':
            if (!owner) return;
            await sendWithLogo('⚠️ *SESSION RESET*\n\nWiping auth folder and requesting new session...\n\n⚠️ You will need to provide a NEW SESSION_ID after this!');
            try {
                const fs = require('fs-extra');
                const path = require('path');
                const authPath = './auth_info';
                fs.emptyDirSync(authPath);
                console.log('[TITAN] Session wiped. Restarting...');
                await sendWithLogo('✅ Session wiped. Restart bot and provide new SESSION_ID.');
            } catch (e) {
                await sendWithLogo(`❌ Reset failed: ${e.message}`);
            }
            process.exit(0);
            break;

        case 'uptime':
            const uptime = moment.duration(Date.now() - startTime).humanize();
            await sendWithLogo(`⚡ *TITAN UPTIME*\n\nRunning smoothly for: *${uptime}*`);
            break;


        case 'block':
        case 'unblock':
            await handleAdmin(sock, msg, jid, sender, cmd, args, text, owner, sendWithLogo);
            break;

        case 'session':
        case 'getsession':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            try {
                const bundle = exportSessionBundle(config.authPath);
                if (!bundle) return sendWithLogo('❌ Failed to package session bundle.');
                await sock.sendMessage(sender, { text: `🔑 *TITAN SESSION BUNDLE*\n\nPaste this full key into your SESSION_ID env variable on your host (Render/Railway/Koyeb/etc.) to keep your session alive permanently:\n\n${bundle}` });
                if (jid !== sender) await sendWithLogo('✅ Session bundle sent to your DM!');
            } catch (e) {
                await sendWithLogo(`❌ Session export error: ${e.message}`);
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

        case 'ai':
        case 'imagine':
        case 'tr':
        case 'translate':
        case 'memory':
        case 'roast':
            await handleTitanAI(sock, jid, cmd, text, msg, sendWithLogo);
            break;

        case 'qr':
        case 'short':
        case 'shorten':
        case 'carbon':
        case 'meme':
        case 'remind':
        case 'todo':
        case 'weather':
        case 'wiki':
        case 'wikipedia':
        case 'lyrics':
        case 'movie':
        case 'imdb':
        case 'afk':
            await handleTools(sock, msg, jid, sender, cmd, args, text, sendWithLogo);
            break;

        case 'warn':
        case 'warns':
        case 'resetwarns':
        case 'poll':
            await handleAdmin(sock, msg, jid, sender, cmd, args, text, owner, sendWithLogo);
            break;

        case 'seturl':
            if (!owner) return sendWithLogo('❌ Owner only command!');
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}seturl [https://your-app.onrender.com]`);
            settings.appUrl = args[0];
            await saveSettings();
            await sendWithLogo(`✅ App URL updated! TITAN will now self-ping every 5 mins to stay alive 24/7.\n\nURL: ${args[0]}`);
            break;

        case 'jid':
            let currentJid = jid;
            const newsletterJid = msg.message?.extendedTextMessage?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid;
            const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

            let jidText = `📍 *CURRENT CHAT:* ${currentJid}`;
            if (newsletterJid) jidText += `\n📢 *CHANNEL:* ${newsletterJid}`;
            if (quotedParticipant) jidText += `\n👤 *QUOTED USER:* ${quotedParticipant}`;
            if (sender !== jid) jidText += `\n👤 *SENDER:* ${sender}`;

            await sendWithLogo(jidText);
            break;

        case 'anticall':
            if (!owner) return;
            if (!args[0]) {
                settings.anticall = !settings.anticall;
                saveSettings();
                await sendWithLogo(settings.anticall ? '✅ *Iron Shield:* Anti-Call Enabled globally.' : '❌ *Iron Shield:* Anti-Call Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.anticall = true;
                saveSettings();
                await sendWithLogo('✅ *Iron Shield:* Anti-Call Enabled.');
            } else if (args[0] === 'off') {
                settings.anticall = false;
                saveSettings();
                await sendWithLogo('❌ *Iron Shield:* Anti-Call Disabled.');
            }
            break;

        case 'ghost':
            if (!owner) return;
            if (!args[0]) {
                settings.ghost = !settings.ghost;
                saveSettings();
                await sendWithLogo(settings.ghost ? '✅ *Ghost Mode:* Auto-Status View Enabled.' : '❌ *Ghost Mode:* Auto-Status View Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.ghost = true;
                saveSettings();
                await sendWithLogo('✅ *Ghost Mode:* Enabled.');
            } else if (args[0] === 'off') {
                settings.ghost = false;
                saveSettings();
                await sendWithLogo('❌ *Ghost Mode:* Disabled.');
            }
            break;

        case 'pulse':
            if (!owner) return;
            if (!args[0]) {
                settings.pulse = !settings.pulse;
                saveSettings();
                await sendWithLogo(settings.pulse ? '✅ *Titan Pulse:* Auto-Bio Updated Enabled.' : '❌ *Titan Pulse:* Auto-Bio Disabled.');
                return;
            }
            if (args[0] === 'on') {
                settings.pulse = true;
                saveSettings();
                await sendWithLogo('✅ *Titan Pulse:* Enabled.');
            } else if (args[0] === 'off') {
                settings.pulse = false;
                saveSettings();
                await sendWithLogo('❌ *Titan Pulse:* Disabled.');
            }
            break;

        case 'publish':
            if (!owner) return;
            const channelJid = config.supportChannel;
            const publishText = text || (quoted ? '' : null);

            if (publishText === null) return sendWithLogo('❌ Provide text or reply to a message to publish.');

            try {
                if (quoted) {
                    await sock.sendMessage(channelJid, { forward: msg.message.extendedTextMessage.contextInfo.quotedMessage, contextInfo: { isForwarded: false } });
                    await sendWithLogo('✅ Message published to channel successfully!');
                } else {
                    await sock.sendMessage(channelJid, { text: publishText });
                    await sendWithLogo('✅ Text published to channel successfully!');
                }
            } catch (e) {
                console.error('[TITAN] Publish Error:', e);
                await sendWithLogo('❌ Failed to publish. Check if bot is admin in the channel.');
            }
            break;

        case 'pp':
        case 'profile':
            try {
                let target;
                if (isGroup(jid)) {
                    // Group logic: reply -> user, no reply -> group
                    target = quotedSender || jid;
                } else {
                    // DM logic: just the other person
                    target = jid;
                }

                const ppUrl = await sock.profilePictureUrl(target, 'image').catch(() => null);
                if (!ppUrl) return sendWithLogo('❌ Profile Picture is private or not set.');

                const imgRes = await axios.get(ppUrl, { responseType: 'arraybuffer' });
                await sock.sendMessage(jid, {
                    image: Buffer.from(imgRes.data),
                    caption: `🖼️ *Profile Picture Retrieval*\nTarget: @${target.split('@')[0]}`,
                    mentions: [target]
                }, { quoted: msg });

            } catch (e) {
                console.error('[TITAN] PP Error:', e);
                await sendWithLogo('❌ Failed to retrieve Profile Picture.');
            }
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

    if (game.type === 'chess') {
        await makeChessMove(sock, jid, sender, input.trim());
        return;
    }

    if (game.type === 'math') {
        if (game.answered) return;
        const userAnswer = input.trim();
        const correctAnswer = game.data.answer;
        const normalizedUser = parseInt(userAnswer, 10);
        const normalizedCorrect = parseInt(correctAnswer, 10);
        if (!isNaN(normalizedUser) && normalizedUser === normalizedCorrect) {
            game.answered = true;
            const user = getUser(sender);
            user.points += 200;
            user.wins += 1;
            saveDb();
            await sock.sendMessage(jid, { text: `🎉 @${sender.split('@')[0]} got it! You earned *200* Titan Points.`, mentions: [sender] }, { quoted: msg });
            gameStore.delete(jid);
        } else {
            await sock.sendMessage(jid, { text: `❌ @${sender.split('@')[0]}, that's not correct. Keep trying!`, mentions: [sender] }, { quoted: msg });
        }
    } else if (game.type === 'hangman') {
        const guess = input.trim().toLowerCase();
        if (!guess || guess.length !== 1 || !/[a-z]/.test(guess)) return;
        const data = game.data;
        if (data.guessed.includes(guess)) {
            await sock.sendMessage(jid, { text: `@${sender.split('@')[0]}, "${guess}" was already guessed.`, mentions: [sender] }, { quoted: msg });
            return;
        }
        data.guessed.push(guess);
        const word = data.word;
        if (word.includes(guess)) {
            const display = word.split('').map(c => data.guessed.includes(c) ? c : '_').join(' ');
            if (!display.includes('_')) {
                gameStore.delete(jid);
                await sock.sendMessage(jid, { text: `🎉 @${sender.split('@')[0]} won! The word was *${word}*!\n🏆 *Victory Royale!*`, mentions: [sender] });
                return;
            }
            await sock.sendMessage(jid, { text: `✅ @${sender.split('@')[0]} guessed *${guess}*! Correct!\n\nWord: \`${display}\``, mentions: [sender] }, { quoted: msg });
        } else {
            data.fails += 1;
            const remaining = data.maxFails - data.fails;
            const display = word.split('').map(c => data.guessed.includes(c) ? c : '_').join(' ');
            if (data.fails >= data.maxFails) {
                gameStore.delete(jid);
                await sock.sendMessage(jid, { text: `💀 *Game Over!* The word was *${word}*.\nBetter luck next time!` });
                return;
            }
            await sock.sendMessage(jid, { text: `❌ @${sender.split('@')[0]} guessed *${guess}* — wrong! (${remaining}/${data.maxFails} lives left)\n\nWord: \`${display}\``, mentions: [sender] }, { quoted: msg });
        }
        const prevIndex = data.currentPlayerIndex;
        const nextIndex = (prevIndex + 1) % game.players.length;
        data.currentPlayerIndex = nextIndex;
        const nextPlayer = game.players[nextIndex];
        const display = word.split('').map(c => data.guessed.includes(c) ? c : '_').join(' ');
        await sock.sendMessage(jid, { text: `👉 Turn: @${nextPlayer.split('@')[0]}\n\nWord: \`${display}\``, mentions: [nextPlayer] });
        gameStore.set(jid, game);
    }
}

module.exports = { handleCommand, handleAntiLink };
