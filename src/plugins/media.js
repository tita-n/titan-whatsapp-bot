const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { config } = require('../../utils');

async function handleMediaConvert(sock, msg, jid, sender, cmd, sendWithLogo) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) return sendWithLogo('❌ Reply to a sticker/status to save it!');

    // --- STATUS SAVER (.sv) ---
    if (cmd === 'sv') {
        const participant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (!participant || !participant.includes('status@broadcast')) {
            // Check if it's just a regular media reply
            const isMedia = quoted.imageMessage || quoted.videoMessage;
            if (!isMedia) return sendWithLogo('❌ Please reply to a Status or Media message.');
        }

        try {
            const isMedia = quoted.imageMessage || quoted.videoMessage;
            if (isMedia) {
                await sock.sendMessage(jid, { text: '⏬ *Downloading status media...*' });
                const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {});
                const type = quoted.imageMessage ? 'image' : 'video';
                const caption = `✅ *Status Saved!* (from @${participant?.split('@')[0] || 'User'})`;
                if (type === 'image') {
                    await sock.sendMessage(sender, { image: buffer, caption });
                } else {
                    await sock.sendMessage(sender, { video: buffer, caption });
                }
            } else {
                const textStatus = quoted.conversation || quoted.extendedTextMessage?.text || '(empty)';
                await sock.sendMessage(sender, { text: `📝 *Saved Text Status*\n\nFrom: @${participant?.split('@')[0]}\n\n${textStatus}` });
            }
            await sendWithLogo('✅ Status sent to your DM.');
        } catch (e) {
            console.error('[TITAN SV] Error:', e);
            await sendWithLogo('❌ Failed to save status.');
        }
        return;
    }

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
