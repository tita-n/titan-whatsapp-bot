const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { config } = require('../../utils');

async function handleMediaConvert(sock, msg, jid, sender, cmd, sendWithLogo) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) return sendWithLogo('❌ Reply to a sticker to convert it!');

    const isSticker = quoted.stickerMessage;
    if (!isSticker) return sendWithLogo('❌ That is not a sticker.');

    try {
        await sock.sendMessage(jid, { text: '🔄 *Converting media...* Please wait.' });
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {});
        const tmpFile = path.join(config.downloadPath, `tmp_${Date.now()}.webp`);
        const outFile = path.join(config.downloadPath, `out_${Date.now()}.${cmd === 'toimage' ? 'png' : 'mp4'}`);

        fs.writeFileSync(tmpFile, buffer);

        if (cmd === 'toimage') {
            // Use ffmpeg to convert webp to png
            exec(`ffmpeg -i ${tmpFile} ${outFile}`, async (err) => {
                if (err) throw err;
                await sock.sendMessage(jid, { image: fs.readFileSync(outFile), caption: '✅ Successfully converted to Image.' }, { quoted: msg });
                cleanup([tmpFile, outFile]);
            });
        } else {
            // tovideo (requires animated sticker)
            exec(`ffmpeg -i ${tmpFile} -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ${outFile}`, async (err) => {
                if (err) throw err;
                await sock.sendMessage(jid, { video: fs.readFileSync(outFile), caption: '✅ Successfully converted to Video.' }, { quoted: msg });
                cleanup([tmpFile, outFile]);
            });
        }
    } catch (e) {
        console.error('[TITAN MEDIA] Error:', e);
        await sendWithLogo('❌ Conversion failed. Ensure you reply to an actual sticker.');
    }
}

function cleanup(files) {
    files.forEach(f => { if (fs.existsSync(f)) fs.removeSync(f); });
}

module.exports = { handleMediaConvert };
