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
            // Logic for blocking users from bot
            break;
    }
}

module.exports = { handleAdmin };
