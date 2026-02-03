const axios = require('axios');

/**
 * TITAN API ENGINE: 2026 Stealth Edition
 * Offloads heavy scraping to robust public proxies.
 */

const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://piped-api.lunar.icu',
    'https://api-piped.mha.fi',
    'https://pipedapi.dotpoint.ovh'
];

const COBALT_API = 'https://api.cobalt.tools/api/json';

/**
 * Searches YouTube via Piped instances (Rotational)
 */
async function searchPiped(query) {
    for (const instance of PIPED_INSTANCES) {
        try {
            console.log(`[TITAN SEARCH] Trying: ${instance}`);
            const res = await axios.get(`${instance}/search?q=${encodeURIComponent(query)}&filter=videos`, { timeout: 5000 });
            if (res.data && res.data.items && res.data.items.length > 0) {
                const item = res.data.items[0];
                return {
                    id: item.url.split('v=')[1] || item.url.split('/').pop(),
                    title: item.title,
                    author: item.uploaderName,
                    duration: item.duration,
                    thumbnail: item.thumbnail,
                    url: `https://youtube.com/watch?v=${item.url.split('v=')[1] || item.url.split('/').pop()}`
                };
            }
        } catch (e) {
            console.error(`[TITAN SEARCH] Instance ${instance} failed: ${e.message}`);
        }
    }
    return null;
}

/**
 * Gets direct audio/video stream via Piped (Rotational)
 */
async function getPipedStream(videoId, type = 'audio') {
    for (const instance of PIPED_INSTANCES) {
        try {
            console.log(`[TITAN STREAM] Trying: ${instance}`);
            const res = await axios.get(`${instance}/streams/${videoId}`, { timeout: 8000 });
            if (res.data) {
                // For audio, pick highest bitrate opus or m4a
                if (type === 'audio') {
                    const audio = res.data.audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];
                    return audio ? audio.url : null;
                }
                // For video, pick 720p or highest available
                const video = res.data.videoStreams.filter(v => !v.videoOnly).sort((a, b) => b.bitrate - a.bitrate)[0];
                return video ? video.url : null;
            }
        } catch (e) {
            console.error(`[TITAN STREAM] Instance ${instance} failed: ${e.message}`);
        }
    }
    return null;
}

/**
 * Universal Downloader via Cobalt API
 */
async function cobaltDownload(url, isAudio = false) {
    try {
        const res = await axios.post(COBALT_API, {
            url: url,
            videoQuality: '720',
            audioFormat: 'mp3',
            filenameStyle: 'basic',
            downloadMode: isAudio ? 'audio' : 'video'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (res.data && res.data.url) return res.data.url;
        if (res.data && res.data.picker) return res.data.picker[0].url;
    } catch (e) {
        console.error('[TITAN COBALT] Error:', e.response?.data || e.message);
    }
    return null;
}

module.exports = { searchPiped, getPipedStream, cobaltDownload };
