# 🛠️ TITAN Bot Troubleshooting Guide (2026 Edition)

If you are experiencing connection issues, "rolling" restarts, or 401 errors, follow this guide.

### 1. "Rolling" Generator / Stuck on Connecting
**Symptoms:** The session generator spins forever or the terminal shows "Requesting code..." but nothing happens.
- **Fix:** 
  1. Ensure your network is stable.
  2. The bot now uses a modern Chrome fingerprint (`Browsers.ubuntu('Chrome')`). If it still sticks, delete the `session-gen/temp` folder and try again.
  3. Wait at least 10 seconds between requests to avoid WhatsApp rate limits.

### 2. Connection Closed Error 401 / device_removed
**Symptoms:** Terminal shows `Connection closed: loggedOut (401)`.
- **Cause:** WhatsApp has invalidated the session. This happens if you log out from your phone, if the session is too old, or if there is an IP conflict.
- **Fix:** 
  1. Go to your bot's files.
  2. **Delete the `auth_info_baileys` folder** (or whatever your `authPath` is).
  3. Restart the bot. It will generate a new QR/Pairing code.
  4. Once linked, copy the new `SESSION_ID` and update your environment variables.

### 3. Multiple "System Online" Messages / Reconnect Loops
**Symptoms:** The bot sends "System Online" to your DM 10 times in a row.
- **Fix:** 
  1. I have implemented a `connectionLock` in `index.js` to prevent this. 
  2. If it persists, ensure you don't have multiple instances of the bot running on different servers (e.g., Render and Railway at the same time).

### 4. .play / .dl Errors
**Symptoms:** "Prince API Error" or "Extraction failed".
- **Fix:** 
  1. PrinceTech API is a public service. If it's down, wait 5-10 minutes.
  2. For `.dl`, ensure the link is public (not a private IG account).

---
**Pro Tip:** Always keep your `SESSION_ID` updated in your host (Render/Railway) to ensure the bot survives server restarts! 🚀
