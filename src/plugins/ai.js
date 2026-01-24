const axios = require('axios');

async function handleAI(sock, jid, sender, text, sendWithLogo) {
    if (!text) return sendWithLogo('❌ Please provide a question or prompt.\nExample: .ai space facts');

    try {
        await sock.sendMessage(jid, { text: '🧠 *Titan is thinking...*' });

        // Using a fast free Llama3 / Gemini proxy API
        const response = await axios.get(`https://api.giftedtech.my.id/api/ai/gpt4?apikey=gifted&q=${encodeURIComponent(text)}`);

        if (response.data && response.data.result) {
            await sendWithLogo(`🤖 *TITAN AI*\n\n${response.data.result}`);
        } else {
            throw new Error('Invalid API response');
        }
    } catch (e) {
        console.error('[TITAN AI] Error:', e.message);
        await sendWithLogo('❌ AI services are currently overwhelmed. Please try again later.');
    }
}

module.exports = { handleAI };
