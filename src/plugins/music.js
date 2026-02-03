const { config } = require('../../utils');
const { searchPrince, downloadPrinceMp3 } = require('./princetech_api');

async function handleMusic(sock, msg, jid, sender, query, sendWithLogo) {
    if (!query) return sendWithLogo(`❌ Usage: ${config.prefix}play [song name]`);

    try {
        await sock.sendMessage(jid, { text: `🔍 *TITAN PRINCE:* Searching for \`${query}\`...` }, { quoted: msg });

        const video = await searchPrince(query);
        if (!video) return sendWithLogo('❌ No results found. Prince API might be throttled.');

        await sock.sendMessage(jid, { text: `🎧 *TITAN PRINCE:* Downloading \`${video.title}\`...` }, { quoted: msg });

        const downloadUrl = await downloadPrinceMp3(video.url);
        if (!downloadUrl) return sendWithLogo('❌ Extraction failed. Video might be restricted or restricted by API.');

        await sock.sendMessage(jid, {
            audio: { url: downloadUrl },
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`,
            ptt: false,
            contextInfo: {
                externalAdReply: {
                    title: video.title,
                    body: `Author: ${video.author} | Duration: ${video.duration} | Views: ${video.views}`,
                    mediaType: 2,
                    thumbnailUrl: video.thumbnail,
                    sourceUrl: video.url,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

    } catch (e) {
        console.error('[TITAN MUSIC] Error:', e.message);
        await sendWithLogo('❌ Prince API Error. Engine might be down.');
    }
}

module.exports = { handleMusic };
