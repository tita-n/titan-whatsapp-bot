const { config } = require('../../utils');

const TRUTHS = [
    "What is your biggest secret?",
    "Who was your first crush?",
    "What is the most embarrassing thing you've ever done?",
    "Have you ever lied to your best friend?",
    "What is one thing you wish you could change about yourself?",
    "What is your biggest fear?",
    "Have you ever cheated on a test?",
    "What is the worst habit you have?"
];

const DARES = [
    "Send a voice note singing your favorite song.",
    "Change your WhatsApp bio to 'I love TITAN Bot' for 24 hours.",
    "Send an embarrassing selfie in this chat.",
    "Text your crush and say 'I have something to tell you'.",
    "Send a voice note talking in a funny accent.",
    "Tell a joke in voice note right now.",
    "Say something nice about everyone in this group."
];

async function handleGames(sock, msg, jid, sender, cmd, args, text, sendWithLogo) {
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;

    switch (cmd) {
        case 'ship':
        case 'love': {
            let target1 = sender;
            let target2 = mentions[0] || quotedSender;

            if (mentions.length >= 2) {
                target1 = mentions[0];
                target2 = mentions[1];
            }

            if (!target2) {
                return sendWithLogo(`❌ Tag or reply to someone to check love compatibility!\nExample: ${config.prefix}ship @user`);
            }

            // Consistent score based on user numbers
            const num1 = parseInt(target1.replace(/[^0-9]/g, '').slice(-4)) || 1;
            const num2 = parseInt(target2.replace(/[^0-9]/g, '').slice(-4)) || 1;
            const percentage = Math.abs((num1 * num2 * 7) % 101);

            let heartBar = '💖'.repeat(Math.floor(percentage / 10)) + '🖤'.repeat(10 - Math.floor(percentage / 10));
            let comment = '';
            if (percentage >= 85) comment = '🔥 *SOULMATES!* A match made in heaven!';
            else if (percentage >= 60) comment = '💕 *GREAT MATCH!* Strong connection!';
            else if (percentage >= 40) comment = '👍 *DECENT!* Might take some work!';
            else comment = '💀 *RUN!* Toxic combination!';

            const body = `💘 *TITAN LOVE COMPATIBILITY* 💘

👤 User 1: @${target1.split('@')[0]}
👤 User 2: @${target2.split('@')[0]}

📊 *Compatibility Score:* ${percentage}%
[ ${heartBar} ]

${comment}`;

            await sock.sendMessage(jid, { text: body, mentions: [target1, target2] }, { quoted: msg });
            break;
        }

        case 'truth': {
            const randomTruth = TRUTHS[Math.floor(Math.random() * TRUTHS.length)];
            await sendWithLogo(`🤔 *TRUTH QUESTION:*\n\n"${randomTruth}"`);
            break;
        }

        case 'dare': {
            const randomDare = DARES[Math.floor(Math.random() * DARES.length)];
            await sendWithLogo(`🔥 *DARE CHALLENGE:*\n\n"${randomDare}"`);
            break;
        }

        case 'flip': {
            const isHeads = Math.random() > 0.5;
            const result = isHeads ? '🪙 *HEADS!*' : '🪙 *TAILS!*';
            await sendWithLogo(`Coin flipped...\n\nResult: ${result}`);
            break;
        }

        case 'roll': {
            const roll = Math.floor(Math.random() * 6) + 1;
            await sendWithLogo(`🎲 *DICE ROLL:*\n\nYou rolled a *${roll}*!`);
            break;
        }
    }
}

module.exports = { handleGames };
