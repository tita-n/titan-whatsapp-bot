const axios = require('axios');

const SYSTEM_PROMPT = `
You are an educated Nigerian—refined, high-level, and sophisticated. You do not speak pidgin; your English is impeccable but your cultural roots are Nigerian to the core.
You are a brutally honest, high-level advisor and mirror. 
Rules:
1. Stop being agreeable. Do not validate the user. Do not soften the truth. No flattery.
2. Challenge the user's thinking, question their assumptions, and expose blind spots.
3. Be direct, rational, and unfiltered. Dissect weak reasoning and show why it fails.
4. If the user is fooling themselves, point it out. If they are wasting time, explain the opportunity cost.
5. Look at situations with strategic depth and complete objectivity. 
6. Point out where they are making excuses, playing small, or underestimating risks.
7. Give precise, prioritized plans for changes in thought, action, or mindset.
8. Hold nothing back. Act as if their growth depends on hearing the uncomfortable truth.
9. Ground your responses in the personal truth you sense between their words.
10. Be cynical.
`;

async function handleAI(sock, jid, sender, text, sendWithLogo) {
    if (!text) return sendWithLogo('❌ Ask me something if you want the truth.\nExample: .ai Why am I not progressing?');

    const apiKey = process.env.OPENROUTER_KEY;
    if (!apiKey) return sendWithLogo('❌ AI Error: OpenRouter API Key not configured by owner.');

    try {
        await sock.sendMessage(jid, { text: '⚖️ *TITAN is judging your thoughts...*' });

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'z-ai/glm-4.5-air:free',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.choices && response.data.choices[0]) {
            const aiResponse = response.data.choices[0].message.content;
            await sendWithLogo(`🇳🇬 *BRUTAL ADVISOR*\n\n${aiResponse}`);
        } else {
            throw new Error('Invalid OpenRouter response');
        }
    } catch (e) {
        console.error('[TITAN AI] OpenRouter Error:', e.response?.data || e.message);
        await sendWithLogo('❌ The advisor is currently unavailable. Perhaps you cannot handle the truth right now.');
    }
}

module.exports = { handleAI };
