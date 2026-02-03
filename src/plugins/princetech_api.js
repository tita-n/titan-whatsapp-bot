const axios = require('axios');

/**
 * TITAN PRINCE ENGINE: 2026 High-Performance Edition
 * Uses PrinceTech public APIs for resilient YouTube search and download.
 */

const API_KEY = 'prince';
const BASE_URL = 'https://api.princetechn.com/api';

/**
 * Searches YouTube via PrinceTech API
 */
async function searchPrince(query) {
    try {
        console.log(`[TITAN PRINCE] Searching: ${query}`);
        const res = await axios.get(`${BASE_URL}/search/yts`, {
            params: { apikey: API_KEY, query: query },
            timeout: 10000
        });

        if (res.data && res.data.results && res.data.results.length > 0) {
            const video = res.data.results[0];
            return {
                id: video.videoId,
                url: video.url,
                title: video.title,
                author: video.author?.name || 'Unknown',
                duration: video.timestamp || '0:00',
                thumbnail: video.image || video.thumbnail,
                views: video.views
            };
        }
    } catch (e) {
        console.error('[TITAN PRINCE] Search Error:', e.message);
    }
    return null;
}

/**
 * Gets direct MP3 download URL via PrinceTech API
 */
async function downloadPrinceMp3(videoUrl) {
    try {
        console.log(`[TITAN PRINCE] Downloading: ${videoUrl}`);
        const res = await axios.get(`${BASE_URL}/download/ytmp3`, {
            params: { apikey: API_KEY, url: videoUrl },
            timeout: 20000
        });

        if (res.data && res.data.result && res.data.result.download_url) {
            return res.data.result.download_url;
        }
    } catch (e) {
        console.error('[TITAN PRINCE] Download Error:', e.message);
    }
    return null;
}

module.exports = { searchPrince, downloadPrinceMp3 };
