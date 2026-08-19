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
    }
}

module.exports = { handleAdmin };
