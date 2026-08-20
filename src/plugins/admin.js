const { config, getOwnerJid } = require('../../utils');

async function handleAdmin(sock, msg, jid, sender, cmd, args, text, owner, sendWithLogo) {
    if (!owner) return sendWithLogo('❌ Owner only command!');

    switch (cmd) {
        case 'broadcast':
        case 'bc':
            const bcMsg = args.join(' ');
            if (!bcMsg) return sendWithLogo('❌ Enter a message to broadcast.');

            try {
                const groups = await sock.groupFetchAllParticipating();
                const groupIds = Object.keys(groups);
                await sendWithLogo(`📢 *Broadcasting to ${groupIds.length} groups...*`);

                let count = 0;
                for (const gJid of groupIds) {
                    try {
                        await sock.sendMessage(gJid, { text: `*📢 [TITAN BROADCAST]*\n\n${bcMsg}` });
                        count++;
                        await new Promise(r => setTimeout(r, 1500)); // Delay to avoid ban
                    } catch (e) { }
                }
                await sendWithLogo(`✅ Broadcast complete! Sent to ${count} groups.`);
            } catch (e) {
                await sendWithLogo(`❌ Broadcast error: ${e.message}`);
            }
            break;

        case 'block':
        case 'unblock':
            let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                         msg.message?.extendedTextMessage?.contextInfo?.participant;
            if (!target && args[0]) {
                const clean = args[0].replace('@', '').replace(/[^0-9]/g, '');
                if (clean) target = `${clean}@s.whatsapp.net`;
            }
            if (!target) return sendWithLogo(`❌ Usage: ${config.prefix}${cmd} @user or reply to message.`);

            try {
                const action = cmd === 'block' ? 'block' : 'unblock';
                await sock.updateBlockStatus(target, action);
                await sendWithLogo(`✅ User @${target.split('@')[0]} has been ${action}ed!`, [target]);
            } catch (e) {
                await sendWithLogo(`❌ Failed to ${cmd} user: ${e.message}`);
            }
            break;

        case 'warn':
        case 'warns':
        case 'resetwarns': {
            const { isGroup, getGroupSettings, saveGroupSettings, isBotAdmin } = require('../../utils');
            if (!isGroup(jid)) return sendWithLogo('❌ Groups only!');

            let warnTarget = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             msg.message?.extendedTextMessage?.contextInfo?.participant;
            if (!warnTarget && args[0]) {
                const clean = args[0].replace('@', '').replace(/[^0-9]/g, '');
                if (clean) warnTarget = `${clean}@s.whatsapp.net`;
            }

            if (!warnTarget && cmd !== 'warns') {
                return sendWithLogo(`❌ Tag or reply to a user.\nExample: ${config.prefix}${cmd} @user [reason]`);
            }

            if (!warnTarget) warnTarget = sender;

            const gs = getGroupSettings(jid);
            if (!gs.warns) gs.warns = {};

            if (cmd === 'warns') {
                const count = gs.warns[warnTarget] || 0;
                await sendWithLogo(`⚠️ User @${warnTarget.split('@')[0]} has *${count}/3* warnings in this group.`, [warnTarget]);
                break;
            }

            if (cmd === 'resetwarns') {
                gs.warns[warnTarget] = 0;
                await saveGroupSettings();
                await sendWithLogo(`✅ Reset warnings for @${warnTarget.split('@')[0]}. Current count: *0/3*`, [warnTarget]);
                break;
            }

            if (cmd === 'warn') {
                const reason = args.slice(1).join(' ') || 'No reason provided';
                const count = (gs.warns[warnTarget] || 0) + 1;
                gs.warns[warnTarget] = count;
                await saveGroupSettings();

                if (count >= 3) {
                    await sendWithLogo(`🚫 @${warnTarget.split('@')[0]} reached *3/3 warnings* and is being kicked!\n\nReason for last warn: ${reason}`, [warnTarget]);
                    gs.warns[warnTarget] = 0;
                    await saveGroupSettings();
                    try {
                        const botAdmin = await isBotAdmin(sock, jid);
                        if (botAdmin) {
                            await sock.groupParticipantsUpdate(jid, [warnTarget], 'remove');
                        }
                    } catch (e) {
                        console.error('[TITAN WARN KICK] Error:', e.message);
                    }
                } else {
                    await sendWithLogo(`⚠️ *WARNING STRIKE (${count}/3)*\n\n👤 User: @${warnTarget.split('@')[0]}\n📝 Reason: ${reason}\n\n_Reaching 3 warnings results in auto-kick!_`, [warnTarget]);
                }
            }
            break;
        }

        case 'poll': {
            const pollRaw = text.slice(config.prefix.length + 4).trim();
            const parts = pollRaw.split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length < 3) {
                return sendWithLogo(`❌ Usage: ${config.prefix}poll Question | Option 1 | Option 2 | Option 3\nExample: ${config.prefix}poll Best Language? | JavaScript | Python | Rust`);
            }
            const name = parts[0];
            const values = parts.slice(1);
            try {
                await sock.sendMessage(jid, {
                    poll: {
                        name: `📊 ${name}`,
                        values: values,
                        selectableCount: 1
                    }
                });
            } catch (e) {
                console.error('[TITAN POLL] Error:', e.message);
                await sendWithLogo('❌ Failed to send poll.');
            }
            break;
        }
    }
}

module.exports = { handleAdmin };
