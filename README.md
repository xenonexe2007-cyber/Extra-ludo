# EXTRA LUDO — Telegram Mini App

EXTRA LUDO is a starter-ready Telegram Ludo project built with Node.js, Express, Telegram Bot API and a responsive HTML/CSS/JS Mini App.

## Features
- Telegram Mini App interface with Premium Neon design
- Create Room, join by room code, 2–4 player rooms
- Play vs a simple server-controlled AI opponent
- Dice rolls, four tokens per player, roll-six-to-start, captures, safe squares, exact finish roll, extra turn on six/capture/finishing, win detection
- Player profile, wins/points and in-memory leaderboard
- Telegram bot commands: `/start`, `/newgame`, `/join CODE`
- Bot token is read from `BOT_TOKEN` environment variable

## Important limitations
- **This version stores rooms and profiles in RAM only.** A Render restart or spin-down clears rooms, match state and leaderboard. Add PostgreSQL/Redis for durable state before launching to many players.
- Render free web services may spin down after inactivity and have usage limits. A sleeping service may delay bot responses and interrupt matches. This is suitable for testing/prototyping, not guaranteed 24/7 production hosting.
- The AI is a simple opponent, not a sophisticated strategy engine.
- Ludo rules vary by region. This project implements a common 4-token, roll-six-to-start, safe-cell, capture and exact-finish rule set.
- No cash betting, withdrawals or real-money rewards are included.

## Files
- `server.js` — Express API, Telegram bot, auth validation and game rules
- `public/index.html` — Mini App layout
- `public/style.css` — responsive neon UI
- `public/app.js` — board rendering and client controls
- `render.yaml` — Render service blueprint
- `.env.example` — environment variable template

## Setup from an Android phone

### 1) Create your bot
1. Open Telegram and search for **@BotFather**.
2. Send `/newbot`, choose a display name (for example `EXTRA LUDO`) and a unique username ending in `bot`.
3. Copy the token privately. **Do not paste it into `server.js`, GitHub, chat, or screenshots.** If it leaks, use BotFather to revoke it and create a new token.

### 2) Upload the project to GitHub
1. Download/extract this ZIP on your phone using ZArchiver.
2. Create a new GitHub repository named `extra-ludo`.
3. Upload all project files and folders. Make sure `public/` contains `index.html`, `style.css`, and `app.js`.
4. Do not upload a real `.env` file or your bot token.

### 3) Deploy on Render
1. Open https://render.com and sign in with GitHub.
2. Choose **New + → Web Service**, then connect the `extra-ludo` repository.
3. Set **Runtime: Node**, **Build Command: `npm install`**, **Start Command: `npm start`**.
4. Choose the Free instance if available for your account and region.
5. In the service's **Environment** section, add:
   - `BOT_TOKEN` = your BotFather token
   - `WEBAPP_URL` = your Render service URL, for example `https://extra-ludo-xxxx.onrender.com` (use your actual URL)
   - `NODE_VERSION` = `20` (optional; render.yaml includes it)
6. Save and deploy. After the first deploy, if you didn't know the URL beforehand, copy the Render URL, set `WEBAPP_URL` to that URL and redeploy.
7. Visit `https://YOUR-RENDER-URL/health`. It should return JSON with `"ok": true`.

### 4) Use the bot
1. Open your bot in Telegram and send `/start`.
2. Press **Play EXTRA LUDO** to open the Mini App.
3. For online play, one player chooses **Create Room** and shares the room code. Other players open the Mini App and choose **Join Room**.
4. Host starts when at least two players have joined.
5. For solo practice, choose **Play vs AI**.
6. Bot commands also work: `/newgame` creates a room and `/join ABC12` joins a room by code.

### 5) Optional: add a BotFather menu button
In @BotFather, use `/mybots` → select your bot → **Bot Settings** → **Menu Button** and set the web app URL to your actual Render URL. Menu button labels/options can vary in Telegram.

## Troubleshooting
- **“Bot token সেট করা হয়নি” / bot doesn't respond:** confirm `BOT_TOKEN` exists in Render Environment and redeploy.
- **Mini App asks to open from Telegram:** this is expected. Open using the bot's `/start` button, not by visiting the URL directly.
- **Mini App says authentication failed:** ensure the app is opened from the correct bot, the `BOT_TOKEN` is valid, and Render has the latest deployment.
- **No Play button:** make sure `WEBAPP_URL` is the full HTTPS Render URL and redeploy.
- **Bot polling conflict:** ensure only one running service/process is using this bot token. Stop any local Termux copy or other Render service using the same token.
- **Room disappears:** the starter version uses RAM-only storage. A restart/sleep clears rooms; add a database for persistence.

## Environment variables
Copy `.env.example` as `.env` only for local development. Never commit `.env`.

`ALLOW_DEV_AUTH=true` is only for local testing. Keep it `false` or unset in production.
