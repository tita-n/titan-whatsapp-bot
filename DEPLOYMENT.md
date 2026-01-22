# 🚀 Deploying TITAN Bot to Render.com

This guide walks you through deploying TITAN WhatsApp Bot to Render's FREE tier for 24/7 operation.

## Prerequisites

- GitHub account
- Render.com account (free)
- UptimeRobot.com account (free, for keeping bot alive)

## Step 1: Push Code to GitHub

### Option A: Create New Repository

1. Go to [GitHub](https://github.com) → New Repository
2. Name it `titan-whatsapp-bot`
3. Make it **Private** (important for security!)
4. Don't initialize with README

```bash
# In your project folder
cd C:\Users\resto\.gemini\antigravity\scratch\whatsapp-bot-baileys

git init
git add .
git commit -m "Initial commit: TITAN WhatsApp Bot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/titan-whatsapp-bot.git
git push -u origin main
```

### Option B: Use Existing Repository

```bash
git add .
git commit -m "Update: TITAN Bot"
git push
```

## Step 2: Create Render Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account if not already
4. Select your `titan-whatsapp-bot` repository
5. Configure the service:

| Setting | Value |
|---------|-------|
| **Name** | titan-whatsapp-bot |
| **Region** | Choose closest to you |
| **Branch** | main |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

6. Click **"Create Web Service"**

## Step 3: Set Environment Variables

In your Render service dashboard:

1. Go to **"Environment"** tab
2. Click **"Add Environment Variable"**
3. Add these variables:

| Key | Value |
|-----|-------|
| `OWNER_NUMBER` | Your WhatsApp number (e.g., `2348012345678`) |
| `BOT_NAME` | TITAN (or your preferred name) |
| `PREFIX` | . (or your preferred prefix) |
| `MODE` | private |

4. Click **"Save Changes"**

## Step 4: Deploy & Get Pairing Code

1. Render will automatically deploy after saving environment variables
2. Go to **"Logs"** tab in your Render dashboard
3. Wait for the **PAIRING CODE** to appear:

```
╔════════════════════════════════════╗
║   PAIRING CODE: XXXX-XXXX          ║
╠════════════════════════════════════╣
║ Open WhatsApp > Linked Devices      ║
║ > Link a Device > Link with         ║
║ phone number > Enter this code      ║
╚════════════════════════════════════╝
```

4. On your phone:
   - Open WhatsApp
   - Go to **Settings** → **Linked Devices**
   - Tap **"Link a Device"**
   - Tap **"Link with phone number instead"**
   - Enter your phone number
   - Enter the pairing code from logs

5. Bot should now show "✅ Connected to WhatsApp!" in logs

## Step 5: Set Up UptimeRobot (Keep Alive)

Render's free tier spins down after 15 minutes of inactivity. UptimeRobot keeps it alive.

1. Go to [UptimeRobot.com](https://uptimerobot.com/) and create free account
2. Click **"Add New Monitor"**
3. Configure:

| Setting | Value |
|---------|-------|
| **Monitor Type** | HTTP(s) |
| **Friendly Name** | TITAN Bot |
| **URL** | `https://YOUR-APP-NAME.onrender.com` |
| **Monitoring Interval** | 5 minutes |

4. Click **"Create Monitor"**

Your bot URL is shown in Render dashboard, looks like:
`https://titan-whatsapp-bot-xxxx.onrender.com`

## Step 6: Verify Everything Works

1. Send `.menu` to your bot's WhatsApp number from owner phone
2. You should receive the command menu with TITAN logo
3. Try `.status` to check bot status

## 📊 Free Tier Limits

Render Free Tier includes:
- ✅ 750 hours/month (enough for 24/7 with one service)
- ✅ Automatic deploys from GitHub
- ✅ HTTPS included
- ⚠️ Disk data may be lost on redeploy (backup regularly!)
- ⚠️ Spins down after 15 min inactivity (hence UptimeRobot)

## 🔄 Updating the Bot

When you push changes to GitHub:

1. Render auto-detects changes and redeploys
2. Bot will disconnect briefly during deploy (~1-2 min)
3. Session persists - no new pairing needed (usually)

## 🆘 Troubleshooting

### Bot keeps disconnecting?
- Check Render logs for errors
- Try redeploying: Render Dashboard → Manual Deploy
- Delete `auth_info` folder and re-pair if needed

### "Logged out" error?
- Session expired or was logged out from phone
- In Render dashboard, go to "Shell" tab
- Run: `rm -rf auth_info`
- Redeploy and get new pairing code

### UptimeRobot shows downtime?
- This is normal during redeploys
- If persistent, check Render status page

### Need to change owner number?
- Update `OWNER_NUMBER` in Environment variables
- Restart service

## 💾 Backing Up Data

The `data/` and `auth_info/` folders are created on Render's disk. To prevent data loss:

1. Use `.backup` command regularly
2. Download the backup JSON file
3. Store safely on your local machine
4. Use `.restore` to restore if needed

## 📱 Managing the Bot

From your WhatsApp:
- `.status` - Check if bot is running
- `.backup` - Download all settings
- `.mode self` - Pause bot (maintenance mode)
- `.mode private` - Resume normal operation

## 🎉 You're Done!

Your TITAN bot should now be running 24/7 on Render's free tier!

---

**Need Help?** Check the main README.md for command reference and troubleshooting tips.
