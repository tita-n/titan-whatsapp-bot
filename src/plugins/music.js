const { config } = require('../../utils');
const { searchPiped, getPipedStream } = require('./media_api');

async function handleMusic(sock, msg, jid, sender, query, sendWithLogo) {
    if (!query) return sendWithLogo(`❌ Usage: ${config.prefix}play [song name]`);

    try {
        await sock.sendMessage(jid, { text: `🔍 *TITAN STEALTH:* Searching for \`${query}\`...` }, { quoted: msg });

        const video = await searchPiped(query);
        if (!video) return sendWithLogo('❌ No results found. All Piped instances might be throttled.');

        await sock.sendMessage(jid, { text: `🎧 *TITAN STEALTH:* Fetching audio stream...` }, { quoted: msg });

        const streamUrl = await getPipedStream(video.id, 'audio');
        if (!streamUrl) return sendWithLogo('❌ Extraction failed. Video might be age-restricted or private.');

        await sock.sendMessage(jid, {
            audio: { url: streamUrl },
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

    } catch (e) {
        console.error('[TITAN MUSIC] Error:', e.message);
        await sendWithLogo('❌ Stealth API Error. Piped instances might be down.');
    }
}

module.exports = { handleMusic };
