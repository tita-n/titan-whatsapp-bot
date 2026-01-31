# 🤖 TITAN - The Ultimate WhatsApp Bot Template

Deploy your own powerful, 24/7 WhatsApp bot in just **60 seconds**! TITAN is designed for speed, privacy, and modularity.

---

## 🚀 One-Click Deploy (Faster & Easier)

1. **Step 1: Get Your Key**
   Go to the [TITAN SESSION GEN](https://titan-gen.onrender.com) (Recommended) or use the internal pairing system.
   *Wait for the code, link your WhatsApp, and copy the long **Memory Key**.*

2. **Step 2: Deploy to Platform**
   Choose your platform and paste the key into the **SESSION_ID** box.

### Option A: Render (100% Free - No Card)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tita-n/titan-whatsapp-bot)

### Option B: Railway (Premium)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/xxx)

---

## 🛠️ Deployment Technical Settings

If you are setting up the services manually (e.g., on Render or a VPS):

### 1. TITAN Bot (Main Bot)
- **Build Command:** `npm install`
- **Start Command:** `npm start`

### 2. TITAN GEN (Session Generator)
- **Build Command:** `npm install`
- **Start Command:** `npm run gen`
- **Port:** Uses the `PORT` env variable (Default: `3000`)

### 🧠 Universal Compatibility
TITAN now features a **Universal Session Decoder**. It automatically detects and strips prefixes (like `Session-ID~...` or `TITAN:`) and validates keys from any Baileys-compatible generator.

### 🆘 Free Trial Ended?
If Railway asks for a credit card, just switch to **Render** using the button above. TITAN works perfectly on Render's free tier. After linking, TITAN will PM you a **"Memory Key"**—add this to your Render settings to stay online 24/7!

---

## 💎 Features

*   🌍 **3 Access Modes**: `.mode` (private / public / group).
*   🎵 **Native Music**: `.play [song]` high-quality YouTube streaming.
*   💾 **Status Saver**: `.sv` (reply to any status to save it).
*   🤖 **AI Brain**: `.ai` powered by GLM-4.5-Air with persistent memory.
*   🛡️ **Iron Shield**: `.anticall` (auto-reject calls globally).
*   👻 **Ghost Mode**: `.ghost` (auto-view all statuses/stories).
*   📢 **Broadcaster**: `.publish` (post instantly to your channel).
*   🖼️ **High-Res Media**: `.pp` (get any profile pic in HD) & `.vv` (anti-viewonce).
*   ⚡ **Titan Pulse**: `.pulse` (auto-updates your Bio with real-time uptime).
*   🎮 **Games**: Hangman Battle Royale, Math Quiz, and more.

---

## ⚙️ Configuration (Optional)

You can customize TITAN via Railway Environment Variables:
- `BOT_NAME`: Name of your bot (Default: TITAN).
- `PREFIX`: Command prefix (Default: `.`).
- `MODE`: Initial mode (Default: `private`).

---

## 👨‍💻 Developer Guide (Creating a Template)

If you are the developer sharing this bot:
1. **Push to GitHub**: Make sure this repo is Public.
2. **First Deploy**: Deploy it on your Railway account from GitHub.
3. **Template Creation**:
   - In your Railway project, go to **Settings** → **Template**.
   - Click **Create Template**.
   - Railway will give you a unique `https://railway.app/template/...` link.
4. **Share**: Share that link with your friends. They can now deploy their own TITAN with one click!

---

## ⚠️ Disclaimer
This bot is for educational purposes. Use responsibly and respect WhatsApp's Terms of Service.

*Built with ❤️ by the TITAN community.*
