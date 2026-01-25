const yts = require('yt-search');
const ytdl = require('ytdl-core');
const fs = require('fs-extra');
const path = require('path');
const { config } = require('../../utils');

async function handleMusic(sock, msg, jid, sender, query, sendWithLogo) {
    if (!query) return sendWithLogo(`❌ Usage: ${config.prefix}play [song name]`);

    try {
        await sock.sendMessage(jid, { text: `🔍 *Searching:* \`${query}\`...` }, { quoted: msg });
        
        const search = await yts(query);
        const video = search.videos[0];
        
        if (!video) return sendWithLogo('❌ Song not found. Try a more specific title.');

        await sock.sendMessage(jid, { text: `⏬ *Downloading:* \`${video.title}\`...\n\n_Channel: ${video.author.name}_` }, { quoted: msg });

        const videoId = video.videoId;
        const filePath = path.join(config.downloadPath, `${videoId}.mp3`);
        
        // Ensure download directory exists
        fs.ensureDirSync(config.downloadPath);

        // Native Download using ytdl-core
        const stream = ytdl(video.url, {
            filter: 'audioonly',
            quality: 'highestaudio',
        });

        const fileStream = fs.createWriteStream(filePath);
        stream.pipe(fileStream);

        await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
            stream.on('error', reject);
        });

        // Check if file exists and has size
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            throw new Error('File download failed or empty');
        }

        await sock.sendMessage(jid, { text: '📤 *Sending audio...*' }, { quoted: msg });

        await sock.sendMessage(jid, {
            audio: { url: filePath },
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`,
            ptt: false, // Normal audio view
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

        // Cleanup
        fs.removeSync(filePath);

    } catch (e) {
        console.error('[TITAN MUSIC] Error:', e);
        await sendWithLogo('❌ Song not found or server error 😔. Try again later.');
        // Cleanup on error if file exists
        const partialFile = path.join(config.downloadPath, `${query.replace(/\s+/g, '_')}.mp3`);
        if (fs.existsSync(partialFile)) fs.removeSync(partialFile);
    }
}

module.exports = { handleMusic };
