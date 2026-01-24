# 🤖 TITAN - The Ultimate WhatsApp Bot ⚡

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
[![Docker Support](https://img.shields.io/badge/Docker-Supported-blue.svg?logo=docker)](Dockerfile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**TITAN** is a powerful, high-performance private WhatsApp bot built for speed, moderation, and group entertainment. Optimized for sub-1 second response times and designed for seamless 24/7 hosting on Render.com.

---

## ⚡ Key Highlights
- **🚀 Ultra-Fast**: Response times below 1 second using intelligent metadata caching.
- **🛡️ Shield Mode**: Advanced Anti-Link and Anti-Spam systems to protect your groups.
- **🎮 Game On**: Multiplayer "Battle Royale" Hangman and Math Quiz with global rankings.
- **keys** Web Pairing: View your pairing code instantly at `/pair` without checking logs.
- **❤️ Permanent Stay**: Bot generates a **Base64 SESSION_ID** so you stay logged in forever on Render.
- **🎵 Music Play**: Stream audio directly from YouTube in high quality.
- **⚡ Hot Updates**: Update the bot instantly with `.update` from your chat.

---

## 🚀 Deployment Options

### 1-Click: Render (Free)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
- **Status**: Excellent for beginners.
- **Tip**: Must use [UptimeRobot](https://uptimerobot.com) to keep it alive 24/7.

### Bot-Hosting.net (Pterodactyl)
1.  **Create Server**: Select **Node.js** as the egg.
2.  **Upload**: Upload all files (skip `node_modules`).
3.  **Startup**: Ensure the startup command is `node index.js`.
4.  **Env**: Add `OWNER_NUMBER`, `PREFIX`, etc., in the "Startup" or "Settings" tab.

### 🐳 Docker (VPS)
```bash
docker-compose up -d
```

---

## 🎮 Multiplayer Mini-Games

### 🎭 Hangman: Battle Royale
5 Rounds of increasing intensity!
- **Round 1**: 6 fails allowed.
- **Round 2**: 4 fails allowed.
- **Round 3+**: Only 2 fails!
- **Strikes**: 3 wrong guesses in a round = **Elimination**.
- **Hint**: Every word starts with 3 letters revealed.

### 🔢 Math Quiz
Speed matters! Be the first to solve the equation to win points.

---

## 🔑 24/7 Persistence (For Render)
To keep the bot online after Render restarts:
1. Link your bot once via `/pair`.
2. The bot will send you a long **Session ID** text in your DM.
3. Copy that text and add it as an Environment Variable in Render:
   - **Key**: `SESSION_ID`
   - **Value**: `Your session string here`
4. Deploy once more. Your bot is now **immortal**!

---

## 📜 Full Commands List

| Category | Command | Description |
| :--- | :--- | :--- |
| **🛠️ Utility** | `.menu` / `.help` | Show the interactive menu. |
| | `.status` | Check uptime and system health. |
| | `.ping` | Test message latency. |
| | `.play [song]` | Search and play music from YouTube. |
| | `.update` | Instant Git Update and Reboot. |
| **👮 Admin** | `.kick` / `.remove` | Remove a member (reply/tag). |
| | `.promote` / `.demote` | Manage group permissions. |
| | `.mute` / `.unmute` | Close or open the group. |
| | `.antilink [on/off]` | Auto-remove external links. |
| | `.antispam [on/off]` | Stop message flooders. |
| | `.setgroup [code]` | **(Owner)** Change auto-join group. |
| | `.setchannel [id]` | **(Owner)** Change auto-join channel. |
| **📥 Media** | `.download [url]` | Multi-platform media downloader. |
| | `.sticker` | Convert image/video to sticker. |
| | `.vv` | Recover View-Once (Silent). |
| **🎮 Games** | `.hangman` | Start a Battle Royale lobby. |
| | `.math` | Start a Math Quiz lobby. |
| | `.join` | Participate in an active lobby. |

---

## ⚙️ Configuration (.env)

| Variable | Description |
| :--- | :--- |
| `OWNER_NUMBER` | Your number in international format (Required). |
| `PREFIX` | Your preferred command prefix (Default: `.`). |
| `MODE` | `private` (default) or `groups`. |
| `PORT` | Web server port (Default: `3000`). |

---

## ⚠️ Stability & Warnings
- **Session Persistence**: Data is saved to `data/settings.json`. Back up regularly if using Free Tier.
- **Account Safety**: Use a secondary number. This bot uses an unofficial API.
- **Support**: By using this bot, you automatically join the creator's group and channel to stay updated.

---

## 🙏 Credits & Appreciation
- Built with [Baileys](https://github.com/WhiskeySockets/Baileys).
- Developed with ❤️ for the community.

---
**Disclaimer**: This project is for educational purposes. We are not responsible for any account bans or misuse of the software.
