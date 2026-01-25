const axios = require('axios');

/**
 * TITAN CORE AI ENGINE
 * Handles: AI Advisor, Language Translation, and Image Generation
 * Backend: OpenRouter (Text/TR) & Pollinations (Imagine)
 */

const ADVISOR_PROMPT = `You are an educated Nigerian—refined, high-level, and sophisticated. You do not speak pidgin; your English is impeccable but your cultural roots are Nigerian to the core. You are a brutally honest, high-level advisor. Challenge the user's thinking, question their assumptions, and expose blind spots. Be direct, rational, unfiltered, and cynical.`;

async function callOpenRouter(prompt, system, userKey) {
    const apiKey = userKey || process.env.OPENROUTER_KEY;
    if (!apiKey) throw new Error('NO_KEY');

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
        ]
    }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });

    return response.data.choices[0].message.content;
}

async function handleTitanAI(sock, jid, cmd, text, msg, sendWithLogo) {
    const apiKey = process.env.OPENROUTER_KEY;

    try {
        if (cmd === 'ai') {
            if (!text) return sendWithLogo('❌ Ask me something if you want the truth.');
            await sock.sendMessage(jid, { text: '⚖️ *TITAN is judging your thoughts...*' }, { quoted: msg });
            const result = await callOpenRouter(text, ADVISOR_PROMPT, apiKey);
            await sendWithLogo(`🇳🇬 *ADVISOR*\n\n${result}`);
        }

        else if (cmd === 'tr' || cmd === 'translate') {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const trText = text || (quoted ? (quoted.conversation || quoted.extendedTextMessage?.text) : null);
            if (!trText) return sendWithLogo('❌ Provide text or reply to a message.');

            await sock.sendMessage(jid, { text: '🌍 *Translating to English...*' }, { quoted: msg });
            const prompt = `Translate the following text to English perfectly. Return ONLY the translated text:\n\n${trText}`;
            const result = await callOpenRouter(prompt, "You are a professional translator.", apiKey);
            await sendWithLogo(`🌍 *TITAN TRANSLATE*\n\n${result}`);
        }

        else if (cmd === 'imagine') {
            if (!text) return sendWithLogo('❌ Usage: .imagine [prompt]');
            await sock.sendMessage(jid, { text: '🎨 *TITAN is painting your prompt...*' }, { quoted: msg });

            // Pollinations.ai is 100% free, fast, and needs no key. Perfect for bots.
            const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(text)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}&nologo=true&enhance=true`;

            const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            await sock.sendMessage(jid, { image: Buffer.from(imageRes.data), caption: `🎨 *TITAN IMAGINE:*\n\n_${text}_` }, { quoted: msg });
        }

    } catch (e) {
        console.error('[TITAN AI ERROR]:', e.message);
        if (e.message === 'NO_KEY') return sendWithLogo('❌ API Key Missing. Set OPENROUTER_KEY.');
        await sendWithLogo('❌ Service temp unavailable. Try again later.');
    }
}

module.exports = { handleTitanAI };
