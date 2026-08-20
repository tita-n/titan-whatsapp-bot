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

        case 'weather': {
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}weather [city name]`);
            const city = args.join(' ');
            try {
                const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 10000 });
                const current = res.data?.current_condition?.[0];
                const area = res.data?.nearest_area?.[0];

                if (!current || !area) throw new Error('Location not found');

                const location = `${area.areaName?.[0]?.value || city}, ${area.country?.[0]?.value || ''}`;
                const tempC = current.temp_C;
                const tempF = current.temp_F;
                const desc = current.weatherDesc?.[0]?.value || 'Clear';
                const humidity = current.humidity;
                const wind = current.windspeedKmph;

                const weatherText = `🌤️ *WEATHER REPORT: ${location.toUpperCase()}*

🌡️ *Temperature:* ${tempC}°C / ${tempF}°F
🌤️ *Condition:* ${desc}
💧 *Humidity:* ${humidity}%
🌬️ *Wind Speed:* ${wind} km/h`;

                await sendWithLogo(weatherText);
            } catch (e) {
                console.error('[TITAN WEATHER] Error:', e.message);
                await sendWithLogo(`❌ Could not fetch weather for "${city}". Check city name.`);
            }
            break;
        }

        case 'wiki':
        case 'wikipedia': {
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}wiki [query]`);
            const query = args.join(' ');
            try {
                const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`, { timeout: 10000 });
                if (!res.data || res.data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
                    throw new Error('Not found');
                }

                const title = res.data.title;
                const extract = res.data.extract || 'No summary available.';
                const wikiUrl = res.data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`;
                const thumbnail = res.data.thumbnail?.source || res.data.originalimage?.source;

                const text = `📚 *WIKIPEDIA: ${title.toUpperCase()}*\n\n${extract}\n\n🔗 *Read more:* ${wikiUrl}`;

                if (thumbnail) {
                    await sock.sendMessage(jid, { image: { url: thumbnail }, caption: text }, { quoted: msg });
                } else {
                    await sendWithLogo(text);
                }
            } catch (e) {
                console.error('[TITAN WIKI] Error:', e.message);
                await sendWithLogo(`❌ No Wikipedia article found for "${query}".`);
            }
            break;
        }

        case 'lyrics': {
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}lyrics [song title]`);
            const song = args.join(' ');
            try {
                await sock.sendMessage(jid, { text: `🎵 *Searching lyrics for "${song}"...*` }, { quoted: msg });
                const res = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(song)}`, { timeout: 10000 });
                const match = res.data?.[0];

                if (!match || !match.plainLyrics) {
                    throw new Error('Lyrics not found');
                }

                const title = match.trackName || song;
                const artist = match.artistName || 'Unknown Artist';
                const lyrics = match.plainLyrics.slice(0, 3000);

                const lyricsText = `🎵 *${title.toUpperCase()}* - ${artist}\n\n${lyrics}`;
                await sendWithLogo(lyricsText);
            } catch (e) {
                console.error('[TITAN LYRICS] Error:', e.message);
                await sendWithLogo(`❌ Lyrics for "${song}" not found.`);
            }
            break;
        }

        case 'movie':
        case 'imdb': {
            if (!args[0]) return sendWithLogo(`❌ Usage: ${config.prefix}movie [movie title]`);
            const title = args.join(' ');
            try {
                const res = await axios.get(`https://www.omdbapi.com/?apikey=33eb8bc3&t=${encodeURIComponent(title)}`, { timeout: 10000 });
                if (!res.data || res.data.Response === 'False') {
                    throw new Error(res.data?.Error || 'Movie not found');
                }

                const m = res.data;
                const movieText = `🎬 *${m.Title.toUpperCase()} (${m.Year})*

⭐ *IMDb Rating:* ${m.imdbRating} / 10
🎭 *Genre:* ${m.Genre}
⏱️ *Runtime:* ${m.Runtime}
🎬 *Director:* ${m.Director}
👥 *Cast:* ${m.Actors}

📖 *Plot:*
${m.Plot}`;

                if (m.Poster && m.Poster !== 'N/A') {
                    await sock.sendMessage(jid, { image: { url: m.Poster }, caption: movieText }, { quoted: msg });
                } else {
                    await sendWithLogo(movieText);
                }
            } catch (e) {
                console.error('[TITAN MOVIE] Error:', e.message);
                await sendWithLogo(`❌ Movie "${title}" not found.`);
            }
            break;
        }

        case 'afk': {
            const reason = args.join(' ') || 'Away From Keyboard';
            if (!settings.afk) settings.afk = {};
            settings.afk[sender] = {
                time: Date.now(),
                reason: reason
            };
            await saveSettings();
            await sendWithLogo(`💤 *@${sender.split('@')[0]} is now AFK:*\n\n"*${reason}*"`, [sender]);
            break;
        }

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
