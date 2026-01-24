const fs = require('fs-extra');
const path = require('path');
const { config } = require('../../utils');

const economyPath = path.join(__dirname, '../../data/economy.json');
fs.ensureFileSync(economyPath);

let db = {};
try {
    db = fs.readJsonSync(economyPath);
} catch (e) {
    db = {};
}

function saveDb() {
    fs.writeJsonSync(economyPath, db, { spaces: 4 });
}

function getUser(sender) {
    if (!db[sender]) {
        db[sender] = { points: 100, lastDaily: 0, wins: 0 };
    }
    return db[sender];
}

async function handleEconomy(sock, jid, sender, cmd, args, sendWithLogo) {
    const user = getUser(sender);

    switch (cmd) {
        case 'daily':
            const now = Date.now();
            const cooldown = 24 * 60 * 60 * 1000;
            if (now - user.lastDaily < cooldown) {
                const remaining = cooldown - (now - user.lastDaily);
                const hours = Math.floor(remaining / (60 * 60 * 1000));
                return sendWithLogo(`❌ You already claimed your daily points! Come back in ${hours} hours.`);
            }
            const amount = Math.floor(Math.random() * 500) + 500;
            user.points += amount;
            user.lastDaily = now;
            saveDb();
            await sendWithLogo(`🎁 *DAILY REWARD*\n\nYou received *${amount}* Titan Points! 🎉\nTotal Balance: *${user.points}*`);
            break;

        case 'balance':
        case 'wallet':
            await sendWithLogo(`💰 *TITAN WALLET*\n\nUser: @${sender.split('@')[0]}\nPoints: *${user.points}* 💎\nWins: *${user.wins}* 🏆`, [sender]);
            break;

        case 'gamble':
            const bet = parseInt(args[0]);
            if (isNaN(bet) || bet <= 0) return sendWithLogo(`❌ Usage: ${config.prefix}gamble [amount]`);
            if (bet > user.points) return sendWithLogo(`❌ You don't have enough points! Balance: ${user.points}`);

            const win = Math.random() > 0.55; // 45% win chance
            if (win) {
                user.points += bet;
                await sendWithLogo(`🎰 *JACKPOT!* 🎰\n\nYou won *${bet}* points! 🎉\nNew Balance: *${user.points}*`);
            } else {
                user.points -= bet;
                await sendWithLogo(`💸 *LOST...* 💸\n\nYou lost *${bet}* points. 💀\nNew Balance: *${user.points}*`);
            }
            saveDb();
            break;

        case 'top':
        case 'leaderboard':
            const sorted = Object.entries(db)
                .sort(([, a], [, b]) => b.points - a.points)
                .slice(0, 10);

            let text = `🏆 *TITAN GLOBAL TOP 10*\n\n`;
            sorted.forEach(([id, u], i) => {
                text += `${i + 1}. @${id.split('@')[0]} - *${u.points}* pts\n`;
            });
            await sendWithLogo(text, sorted.map(([id]) => id));
            break;
    }
}

module.exports = { handleEconomy, getUser, saveDb };
