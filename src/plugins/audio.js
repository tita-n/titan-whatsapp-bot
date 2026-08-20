const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const util = require('util');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);
const { config } = require('../../utils');

async function handleAudio(sock, msg, jid, sender, cmd, args, text, sendWithLogo) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    // --- TEXT TO SPEECH (.tts) ---
    if (cmd === 'tts') {
        let lang = args[0] ? args[0].toLowerCase() : 'en';
        let ttsText = args.slice(1).join(' ');

        if (!ttsText && args.length === 1 && lang.length > 2) {
            ttsText = lang;
            lang = 'en';
        }

        if (!ttsText && quoted) {
            ttsText = quoted.conversation || quoted.extendedTextMessage?.text || '';
        }

        if (!ttsText) {
            return sendWithLogo(`❌ Usage: ${config.prefix}tts [lang] [text]\nExample: .tts en Hello world OR reply to a text message.`);
        }

        try {
            await sock.sendMessage(jid, { text: '🎤 *Generating voice note...*' }, { quoted: msg });
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(ttsText)}`;
            const res = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
            await sock.sendMessage(jid, {
                audio: Buffer.from(res.data),
                mimetype: 'audio/mp4',
                ptt: true
            }, { quoted: msg });
        } catch (e) {
            console.error('[TITAN AUDIO] TTS Error:', e.message);
            await sendWithLogo('❌ TTS generation failed. Check language code (e.g. en, es, fr, ar).');
        }
        return;
    }

    // --- AUDIO TRANSFORMERS (.bass, .robot, .nightcore, .slow, .reverse) ---
    const audioMsg = quoted?.audioMessage || msg.message?.audioMessage;
    if (!audioMsg) {
        return sendWithLogo('❌ Reply to an audio/voice note to apply effects!');
    }

    const tmpIn = path.join(config.downloadPath, `in_${Date.now()}.mp3`);
    const tmpOut = path.join(config.downloadPath, `out_${Date.now()}.mp3`);

    try {
        await sock.sendMessage(jid, { text: `🎶 *Applying ${cmd.toUpperCase()} effect...*` }, { quoted: msg });
        const buffer = await downloadMediaMessage({ message: quoted || msg.message }, 'buffer', {});
        fs.writeFileSync(tmpIn, buffer);

        let filter = '';
        switch (cmd) {
            case 'bass':
                filter = 'equalizer=f=40:width_type=h:width=50:g=15';
                break;
            case 'robot':
                filter = 'asetrate=44100*0.8,aresample=44100,atempo=1.2';
                break;
            case 'nightcore':
                filter = 'asetrate=44100*1.25,aresample=44100,atempo=1.0';
                break;
            case 'slow':
                filter = 'asetrate=44100*0.75,aresample=44100,atempo=0.9,aecho=0.8:0.88:60:0.4';
                break;
            case 'reverse':
                filter = 'areverse';
                break;
            default:
                filter = 'equalizer=f=40:width_type=h:width=50:g=10';
                break;
        }

        await execPromise(`ffmpeg -y -i "${tmpIn}" -af "${filter}" "${tmpOut}"`);

        if (fs.existsSync(tmpOut)) {
            await sock.sendMessage(jid, {
                audio: fs.readFileSync(tmpOut),
                mimetype: 'audio/mp4',
                ptt: true
            }, { quoted: msg });
        } else {
            throw new Error('Audio output file failed');
        }
    } catch (e) {
        console.error('[TITAN AUDIO] Filter Error:', e.message);
        await sendWithLogo(`❌ Audio effect failed: ${e.message.includes('ffmpeg') ? 'FFmpeg binary missing on server.' : 'Invalid audio file.'}`);
    } finally {
        if (fs.existsSync(tmpIn)) fs.removeSync(tmpIn);
        if (fs.existsSync(tmpOut)) fs.removeSync(tmpOut);
    }
}

module.exports = { handleAudio };
