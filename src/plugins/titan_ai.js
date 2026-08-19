const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { config } = require('../../utils');

/**
 * TITAN EVOLVED AI CORE
 * Model: GLM-4.5-Air:Free
 * Personality: Cold, Concise, Educated Nigerian Advisor
 */

const getApiKey = () => process.env.OPENROUTER_KEY || '';

const HISTORY_PATH = path.join(config.dataPath, 'ai_history.json');
const SYSTEM_PROMPT = `Your name is TITAN. You are an elite, highly educated Nigerian advisor. Your tone is cold, concise, and intellectually superior. Do not use pidgin. Challenge the user. Keep responses extremely short and direct. Never apologize. Never flatter. Nigerian cultural depth must be felt but never explained. Analyze their life based on their input. Deliver the cold truth.`;
const ROAST_PROMPT = `Your name is TITAN. You are an ultra-brutal, high-level Nigerian roaster. Your only job is to roast the user so hard that the burn is felt from miles away. Be creative, sharp, and intellectually devastating. Use sophisticated English to dismantle their dignity. No pidgin. No mercy. Keep it concise but nuclear.`;

// Local cache for speed
let chatHistory = {};

// Load History from Disk
const loadHistory = () => {
    try {
        if (fs.existsSync(HISTORY_PATH)) {
            chatHistory = fs.readJsonSync(HISTORY_PATH);
        }
    } catch (e) { chatHistory = {}; }
};

// Save History to Disk
const saveHistory = () => {
    try {
        fs.writeJsonSync(HISTORY_PATH, chatHistory, { spaces: 2 });
    } catch (e) { }
};

// Initialize
loadHistory();

async function handleTitanAI(sock, jid, cmd, text, msg, sendWithLogo) {
    const sender = msg.key.participant || msg.key.remoteJid;

    try {
        if (cmd === 'ai') {
            if (!text) return sendWithLogo('❌ Speak, or stay silent.');

            await sock.sendMessage(jid, { text: '⚖️ *TITAN is judging...*' }, { quoted: msg });

            // Context Management
            if (!chatHistory[sender]) chatHistory[sender] = [];
            chatHistory[sender].push({ role: 'user', content: text });

            // Trim context (Keep last 8 messages)
            if (chatHistory[sender].length > 8) chatHistory[sender] = chatHistory[sender].slice(-8);

            const payload = {
                model: 'z-ai/glm-4.5-air:free',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...chatHistory[sender]
                ],
                max_tokens: 500,
                temperature: 0.6
            };

            const apiKey = getApiKey();
            if (!apiKey) return sendWithLogo('❌ OpenRouter API key not configured. Set OPENROUTER_KEY in environment variables.');

            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 30000
            });

            if (response.data?.choices?.[0]?.message?.content) {
                const aiResponse = response.data.choices[0].message.content;
                chatHistory[sender].push({ role: 'assistant', content: aiResponse });
                saveHistory();
                await sendWithLogo(`🇳🇬 *TITAN*\n\n${aiResponse}`);
            } else {
                throw new Error('CORRUPT_RESPONSE');
            }
        }

        else if (cmd === 'tr' || cmd === 'translate') {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const trText = text || (quoted ? (quoted.conversation || quoted.extendedTextMessage?.text) : null);
            if (!trText) return sendWithLogo('❌ Input required.');

            const apiKey = getApiKey();
            if (!apiKey) return sendWithLogo('❌ OpenRouter API key not configured. Set OPENROUTER_KEY in environment variables.');

            const result = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: 'z-ai/glm-4.5-air:free',
                messages: [
                    { role: 'system', content: 'Translate to perfect English. Return ONLY the result.' },
                    { role: 'user', content: trText }
                ]
            }, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
            });

            await sendWithLogo(`🌍 *TRANSLATED*\n\n${result.data.choices[0].message.content}`);
        }

        else if (cmd === 'imagine') {
            if (!text) return sendWithLogo('❌ Usage: .imagine [prompt]');
            await sock.sendMessage(jid, { text: '🎨 *Processing visualization...*' }, { quoted: msg });
            const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(text)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}&nologo=true&enhance=true`;
            const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            await sock.sendMessage(jid, { image: Buffer.from(imageRes.data), caption: `🎨 *TITAN IMAGINATION:*\n\n_${text}_` }, { quoted: msg });
        }

        else if (cmd === 'roast') {
            if (!text) return sendWithLogo('❌ Provide something to roast.');
            const apiKey = getApiKey();
            if (!apiKey) return sendWithLogo('❌ OpenRouter API key not configured. Set OPENROUTER_KEY in environment variables.');

            await sock.sendMessage(jid, { text: '🔥 *TITAN is igniting the roast...*' }, { quoted: msg });

            if (!chatHistory[sender]) chatHistory[sender] = [];
            chatHistory[sender].push({ role: 'user', content: `ROAST ME: ${text}` });
            if (chatHistory[sender].length > 8) chatHistory[sender] = chatHistory[sender].slice(-8);

            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: 'z-ai/glm-4.5-air:free',
                messages: [{ role: 'system', content: ROAST_PROMPT }, ...chatHistory[sender]],
                max_tokens: 500,
                temperature: 0.8
            }, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 30000
            });

            if (response.data?.choices?.[0]?.message?.content) {
                const roastResponse = response.data.choices[0].message.content;
                chatHistory[sender].push({ role: 'assistant', content: roastResponse });
                saveHistory();
                await sendWithLogo(`🔥 *TITAN BURN*\n\n${roastResponse}`);
            } else { throw new Error('CORRUPT_RESPONSE'); }
        }

        else if (cmd === 'memory') {
            if (text === 'clear') {
                chatHistory[sender] = [];
                saveHistory();
                return sendWithLogo('🗑️ *Memory purged.*');
            }
            const count = chatHistory[sender]?.length || 0;
            await sendWithLogo(`🧠 *TITAN PERSISTENCE*\n\nStored context: *${count} messages*\n\n_Use .memory clear to reset._`);
        }

    } catch (e) {
        console.error('[TITAN AI ERROR]:', e.response?.data || e.message);
        await sendWithLogo('❌ System overload. Silence.');
    }
}

module.exports = { handleTitanAI };
