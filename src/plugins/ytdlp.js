const YTDlpWrap = require('yt-dlp-wrap-plus').default;
const fs = require('fs-extra');
const path = require('path');
const { config } = require('../../utils');

const binDir = path.join(process.cwd(), 'yt-dlp-bin');
const binPath = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
fs.ensureDirSync(binDir);

const ytDlp = new YTDlpWrap(binPath);

/**
 * Ensures yt-dlp binary is present. 
 * Downloads it if missing or outdated.
 */
async function ensureBinary() {
    if (!fs.existsSync(binPath)) {
        console.log('[TITAN] yt-dlp binary missing. Downloading...');
        try {
            await YTDlpWrap.downloadFromGithub(binPath);
            console.log('[TITAN] yt-dlp binary downloaded successfully.');
        } catch (e) {
            console.error('[TITAN] Failed to download yt-dlp binary:', e);
            throw e;
        }
    }
}

/**
 * High-speed YouTube search using yt-dlp with stealth headers.
 */
async function searchYoutube(query) {
    await ensureBinary();
    try {
        const result = await ytDlp.execPromise([
            `ytsearch1:${query}`,
            '--dump-json',
            '--no-playlist',
            '--flat-playlist',
            '--impersonate', 'chrome',
            '--extractor-args', 'youtube:player_client=ios,web',
            '--no-check-certificates'
        ]);
        const data = JSON.parse(result);
        return {
            title: data.title,
            url: data.url || `https://www.youtube.com/watch?v=${data.id}`,
            id: data.id,
            duration: data.duration_string || data.duration,
            thumbnail: data.thumbnail,
            author: data.uploader || data.channel
        };
    } catch (e) {
        console.error('[TITAN] YT Search Stealth Error:', e);
        return null;
    }
}

/**
 * Download audio or video from any supported URL using stealth engine.
 */
async function downloadMedia(url, type = 'audio') {
    await ensureBinary();
    const timestamp = Date.now();
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const filePath = path.join(config.downloadPath, `titan_${timestamp}.${ext}`);
    fs.ensureDirSync(config.downloadPath);

    const stealthArgs = [
        '--impersonate', 'chrome',
        '--extractor-args', 'youtube:player_client=ios,web',
        '--no-check-certificates'
    ];

    const args = type === 'audio'
        ? [url, '-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '-o', filePath, ...stealthArgs]
        : [url, '-f', 'bestvideo+bestaudio/best', '-o', filePath, '--merge-output-format', 'mp4', ...stealthArgs];

    try {
        await ytDlp.execPromise(args);
        if (fs.existsSync(filePath)) return filePath;
    } catch (e) {
        console.error('[TITAN] Media Download Stealth Error:', e);
    }
    return null;
}

module.exports = { ensureBinary, searchYoutube, downloadMedia, ytDlp };
