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
- **📥 Media Master**: One-click downloader for TikTok (no watermark), Instagram, YouTube, and Facebook.
- **🔑 Web Pairing**: View your pairing code instantly at `/pair` without checking logs.
- **❤️ Support Built-in**: Users automatically support the creator by joining the official community on connection.

---

## 🚀 1-Click Deployment (Render)

1.  **Fork** this repository to your private GitHub account.
2.  Click the **Deploy to Render** button above.
3.  Fill in your **Environment Variables**:
    *   `OWNER_NUMBER`: Your WhatsApp number (e.g., `2348083433738`)
    *   `BOT_NAME`: Your bot's custom name.
4.  Once deployed, visit `https://your-app-name.onrender.com/pair`.
5.  Link your device using the code shown on the screen. **Done!**

---

## 🐳 Docker Deployment (VPS/Local)

For advanced users or VPS hosting:

```bash
# Clone the repository
git clone https://github.com/tita-n/titan-whatsapp-bot.git
cd titan-whatsapp-bot

# Edit environment variables in docker-compose.yml
# Then start the container
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

## 📜 Commands List

| Category | Command | Description |
| :--- | :--- | :--- |
| **🛠️ Utility** | `.menu` / `.help` | Show the interactive menu. |
| | `.status` | Check uptime and system health. |
| | `.ping` | Test message latency. |
| **👮 Admin** | `.kick` / `.remove` | Remove a member (reply/tag). |
| | `.promote` / `.demote` | Manage group permissions. |
| | `.mute` / `.unmute` | Close or open the group. |
| | `.antilink [on/off]` | Auto-remove external links. |
| | `.antispam [on/off]` | Stop message flooders. |
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
