const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { config } = require('../../utils');

async function handleMusic(sock, msg, jid, sender, query, sendWithLogo) {
    if (!query) return sendWithLogo(`❌ Usage: ${config.prefix}play [song name]`);

    try {
        await sock.sendMessage(jid, { text: `🔍 *Searching:* \`${query}\`...` }, { quoted: msg });

        const search = await yts(query);
        const video = search.videos[0];
        if (!video) return sendWithLogo('❌ Song not found.');

        const filePath = path.join(config.downloadPath, `${video.videoId}.mp3`);
        fs.ensureDirSync(config.downloadPath);

        let success = false;

        // --- ATTEMPT 1: NATIVE YTDL ---
        try {
            await sock.sendMessage(jid, { text: `⏬ *Downloading:* \`${video.title}\` (Native Engine)...` }, { quoted: msg });
            const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' });
            const fileStream = fs.createWriteStream(filePath);
            stream.pipe(fileStream);

            await new Promise((resolve, reject) => {
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
                stream.on('error', reject);
                setTimeout(() => reject(new Error('Timeout')), 60000);
            });
            if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) success = true;
        } catch (e) {
            console.log('[TITAN MUSIC] Native Engine failed, switching to Fallback API...');
        }

        // --- ATTEMPT 2: FALLBACK API ---
        if (!success) {
            try {
                await sock.sendMessage(jid, { text: `🔄 *Switching Engine...* (Cloud Relay)` }, { quoted: msg });
                const res = await axios.get(`https://api.vyt.moe/v1/download?url=${encodeURIComponent(video.url)}&format=mp3`, { timeout: 30000 });
                if (res.data?.url) {
                    const mediaRes = await axios.get(res.data.url, { responseType: 'arraybuffer' });
                    fs.writeFileSync(filePath, Buffer.from(mediaRes.data));
                    success = true;
                }
            } catch (e) { }
        }

        if (success) {
            await sock.sendMessage(jid, {
                audio: { url: filePath },
                mimetype: 'audio/mpeg',
                fileName: `${video.title}.mp3`,
                ptt: false,
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
            fs.removeSync(filePath);
        } else {
            throw new Error('All engines failed');
        }

    } catch (e) {
        console.error('[TITAN MUSIC] Error:', e.message);
        await sendWithLogo('❌ All music engines are throttled. Please try again in a few minutes.');
    }
}

module.exports = { handleMusic };
