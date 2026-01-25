# 🚀 TITAN - Official One-Click Deployment Guide

This guide is designed for **non-tech users** who want to have their own powerful, 24/7 WhatsApp bot without writing a single line of code.

---

### 🏁 Step 1: Pre-requisites (One-time)
1. **GitHub**: Create a free account on [GitHub.com](https://github.com).
2. **Railway**: Create a free account on [Railway.app](https://railway.app). Link it to your GitHub.
3. **WhatsApp**: Have your phone ready with WhatsApp installed.

---

### 📦 Step 2: "Fork" the Bot (Clone it)
1. Open the [TITAN Repository](https://github.com/tita-n/titan-whatsapp-bot) in your browser.
2. Click the **"Fork"** button at the top right of the page.
3. Click **"Create Fork"**. 
   *   *Now you have your own personal copy of the bot code in your GitHub account!*

---

### 🚀 Step 3: Deploy to Railway
1. Go to your [Railway Dashboard](https://railway.app/dashboard).
2. Click **"+ New Project"**.
3. Select **"Deploy from GitHub repo"**.
4. Choose the repository you just forked (e.g., `yourname/titan-whatsapp-bot`).
5. Click **"Deploy Now"**.
   *   *Railway is now building your bot server. This takes about 60 seconds.*

---

### 🔑 Step 4: Link Your WhatsApp
1. On Railway, click on your **"titan-whatsapp-bot"** service.
2. Click the **"Logs"** tab at the top.
3. Watch the logs. After a moment, you will see a big green box saying:
   `PAIRING CODE: ABCD-WXYZ`
4. **On Your Phone**:
   - Open WhatsApp.
   - Go to **Settings** → **Linked Devices**.
   - Tap **"Link a Device"**.
   - Choose **"Link with phone number instead"**.
   - Enter the **8-Character Pairing Code** from the Railway logs.

---

### 👑 Step 5: Take Ownership
1. Once linked, the Railway logs will say `✅ Connected!`.
2. **Send ANY message** (e.g., "Hello") to your bot from your phone.
3. TITAN will reply: *"🎉 TITAN CONNECTED! You have been auto-detected as the OWNER."*
4. **Done!** Type `.menu` to see all commands.

---

### 💎 Pro Tips for Users:
*   **24/7 Connectivity**: Your bot stays online as long as Railway is running. 
*   **Updates**: If Titan releases new features, you can run `.update` in the bot chat to get them instantly!
*   **Customization**: In Railway settings, you can add "Variables" like `BOT_NAME` to change yours from "TITAN" to anything you like.

---
*Built with ❤️ by Titan (@titan_griid)*
