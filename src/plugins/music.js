const fs = require('fs-extra');
const { config } = require('../../utils');
const { searchYoutube, downloadMedia } = require('./ytdlp');

async function handleMusic(sock, msg, jid, sender, query, sendWithLogo) {
    if (!query) return sendWithLogo(`❌ Usage: ${config.prefix}play [song name]`);

    try {
        await sock.sendMessage(jid, { text: `🔍 *Searching TITAN Engine:* \`${query}\`...` }, { quoted: msg });

        const video = await searchYoutube(query);
        if (!video) return sendWithLogo('❌ No results found or engine throttled.');

        await sock.sendMessage(jid, { text: `⏬ *Downloading:* \`${video.title}\` (Turbo Engine)...` }, { quoted: msg });

        const filePath = await downloadMedia(video.url, 'audio');
        if (!filePath) return sendWithLogo('❌ Download failed. Link might be restricted.');

        const stats = fs.statSync(filePath);
        if (stats.size > 50 * 1024 * 1024) { // 50MB limit for free tier
            fs.removeSync(filePath);
            return sendWithLogo('❌ File too large for free tier (Limit: 50MB).');
        }

        await sock.sendMessage(jid, {
            audio: { url: filePath },
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`,
            ptt: false,
            contextInfo: {
                externalAdReply: {
                    title: video.title,
                    body: `Author: ${video.author} | Duration: ${video.duration}`,
                    mediaType: 2,
                    thumbnailUrl: video.thumbnail,
                    sourceUrl: video.url,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        fs.removeSync(filePath);

    } catch (e) {
        console.error('[TITAN MUSIC] Error:', e.message);
        await sendWithLogo('❌ YT-DLP Error. Please try again later.');
    }
}

module.exports = { handleMusic };
