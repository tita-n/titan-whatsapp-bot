const axios = require('axios');
const qr = require('qr-image');
const { config, settings, saveSettings } = require('../../utils');

async function handleTools(sock, msg, jid, sender, cmd, args, text, sendWithLogo) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    switch (cmd) {
        case 'imagine':
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}imagine [prompt]`);
            try {
                const prompt = args.join(' ');
                await sendWithLogo(`⌛ *TITAN AI Visualizer:* Rendering "${prompt}"...`);
                const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 10000)}&nologo=true&enhance=true`;
                const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                await sock.sendMessage(jid, { image: Buffer.from(imageRes.data), caption: `🎨 *Imagine:* ${prompt}` }, { quoted: msg });
            } catch (e) {
                console.error('[TITAN TOOLS] Imagine Error:', e.message);
                await sendWithLogo('❌ AI Image generation failed. Try again with a different prompt.');
            }
            break;

        case 'translate':
        case 'tr':
            const trText = args.join(' ') || (quoted ? (quoted.conversation || quoted.extendedTextMessage?.text) : null);
            if (!trText) return sendWithLogo(`❌ Usage: ${config.prefix}translate [text] OR reply to message.`);
            try {
                const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(trText)}`);
                const translated = res.data[0].map(item => item[0]).filter(Boolean).join(' ');
                await sendWithLogo(`🌍 *Translation (to EN):*\n\n${translated}`);
            } catch (e) {
                console.error('[TITAN TOOLS] Translate Error:', e.message);
                await sendWithLogo('❌ Translation service temporarily unavailable.');
            }
            break;

        case 'qr':
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}qr [text/url]`);
            try {
                const qrBuffer = qr.imageSync(args.join(' '), { type: 'png', margin: 4 });
                await sock.sendMessage(jid, { image: qrBuffer, caption: `✅ *QR Code Generated*` }, { quoted: msg });
            } catch (e) {
                await sendWithLogo('❌ Failed to generate QR.');
            }
            break;

        case 'short':
        case 'shorten':
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}short [url]`);
            try {
                const res = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(args[0])}`);
                await sendWithLogo(`🔗 *Shortened Link:*\n${res.data}`);
            } catch (e) {
                await sendWithLogo('❌ Shortener service offline.');
            }
            break;

        case 'carbon':
            const code = args.join(' ') || (quoted ? (quoted.conversation || quoted.extendedTextMessage?.text) : null);
            if (!code) return sendWithLogo('❌ Provide code or reply to a message with code.');
            try {
                await sendWithLogo('✨ *Generating Carbon snippet...*');
                const carbonUrl = `https://quickchart.io/carbon?code=${encodeURIComponent(code)}&theme=dracula`;
                const imageRes = await axios.get(carbonUrl, { responseType: 'arraybuffer', timeout: 20000 });
                await sock.sendMessage(jid, { image: Buffer.from(imageRes.data), caption: '💻 *Carbon Snippet*' }, { quoted: msg });
            } catch (e) {
                console.error('[TITAN TOOLS] Carbon Error:', e.message);
                await sendWithLogo('❌ Carbon service error. Try again later.');
            }
            break;

        case 'meme':
            const memeText = args.join(' ');
            if (!memeText.includes('|')) return sendWithLogo(`❌ Usage: ${config.prefix}meme top text | bottom text`);
            const [top, bottom] = memeText.split('|').map(t => t.trim().replace(/\s+/g, '_'));
            const memeUrl = `https://api.memegen.link/images/drake/${top}/${bottom}.png`;
            try {
                const memebuffer = await axios.get(memeUrl, { responseType: 'arraybuffer' });
                await sock.sendMessage(jid, { image: Buffer.from(memebuffer.data), caption: '🤡 *TITAN Meme*' }, { quoted: msg });
            } catch (e) {
                await sendWithLogo('❌ Meme API down.');
            }
            break;

        case 'remind':
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}remind [task] in [time]\nExample: .remind buy milk in 1h`);
            const remindRaw = args.join(' ');
            // Simple "in" parser
            const matchIn = remindRaw.match(/(.*) in (\d+)([smhd])/i);
            if (!matchIn) return sendWithLogo('❌ Format: .remind [task] in [digit][s/m/h/d]');

            const task = matchIn[1];
            const val = parseInt(matchIn[2]);
            const unit = matchIn[3].toLowerCase();

            const ms = unit === 's' ? val * 1000 : unit === 'm' ? val * 60000 : unit === 'h' ? val * 3600000 : val * 86400000;
            const targetTime = Date.now() + ms;

            settings.reminders.push({
                id: Date.now().toString(),
                sender,
                jid,
                task,
                time: targetTime
            });
            await saveSettings();
            await sendWithLogo(`⏰ *Reminder Set!*\n\nI will remind you about "*${task}*" in ${val}${unit}.`);
            break;

        case 'todo':
            if (!settings.todo[sender]) settings.todo[sender] = [];
            if (!args[0]) {
                const list = settings.todo[sender];
                if (list.length === 0) return sendWithLogo('📝 *Your To-Do List is empty.*');
                let body = '📝 *YOUR TO-DO LIST:*\n\n';
                list.forEach((t, i) => body += `${i + 1}. ${t}\n`);
                body += `\n_Use ${config.prefix}todo clear to wipe._`;
                return sendWithLogo(body);
            }
            if (args[0] === 'add') {
                const newTask = args.slice(1).join(' ');
                if (!newTask) return sendWithLogo('❌ Usage: .todo add [task]');
                settings.todo[sender].push(newTask);
                await saveSettings();
                await sendWithLogo('✅ Task added to list.');
            } else if (args[0] === 'clear') {
                settings.todo[sender] = [];
                await saveSettings();
                await sendWithLogo('🗑️ To-Do list cleared.');
            }
            break;
    }
}

module.exports = { handleTools };
