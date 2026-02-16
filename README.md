# Pod Curious — Setup Guide

**Share a podcast episode. Build a playlist around it.**

Pod Curious analyzes podcast episodes you share and builds personalized playlists based on the themes, guests, and topics it finds.

---

## What You'll Need

- A Mac (these instructions are for macOS)
- About 10 minutes
- A credit/debit card (for API keys — costs are minimal, ~$0.01–0.03 per use)

---

## Step 1: Open Terminal

Terminal is a built-in app on your Mac. To open it:

1. Press **⌘ Cmd + Space** to open Spotlight
2. Type **Terminal**
3. Press **Enter**

A window with a dark or light background and a blinking cursor will appear. This is where you'll type commands.

---

## Step 2: Check if Node.js is Installed

Node.js is the engine that runs Pod Curious. Type this in Terminal and press Enter:

```
node --version
```

**If you see a version number** (like `v18.17.0` or higher) — you're good, skip to Step 3.

**If you see "command not found"** — install Node.js:

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the green button)
3. Open the downloaded file and follow the installer
4. Close Terminal completely and reopen it
5. Run `node --version` again to confirm it works

---

## Step 3: Get Your API Keys

Pod Curious needs two API keys to work. Think of these as passwords that let the app access external services.

### 3a: Anthropic API Key (required — powers the AI)

1. Go to **https://console.anthropic.com**
2. Create an account (or sign in)
3. Go to **Settings → Billing** and add a payment method
4. Go to **API Keys** and click **Create Key**
5. Copy the key — it starts with `sk-ant-...`
6. **Save it somewhere safe** (like Notes). You'll need it shortly.

> **Cost:** Each playlist generation costs about $0.01–0.03. A few dollars will last weeks of casual use.

### 3b: Listen Notes API Key (recommended — finds episode links)

1. Go to **https://www.listennotes.com/api/pricing/**
2. Click **Subscribe** under the **Free** plan
3. Sign in with Google, Facebook, or Twitter
4. Go to your **API Dashboard** at https://www.listennotes.com/api/dashboard/
5. Copy your API key
6. **Save it somewhere safe** next to your Anthropic key.

> **Cost:** Free plan — 300 requests/month, no credit card needed.

---

## Step 4: Set Up the App

### 4a: Create the project folder

Copy and paste this into Terminal, then press Enter:

```
mkdir -p ~/pod-curious/public
```

### 4b: Move the files into place

You should have received 3 files:
- `pod-curious-server.js`
- `pod-curious-index.html`
- `pod-curious-package.json`

After downloading them, run these commands in Terminal:

```
mv ~/Downloads/pod-curious-server.js ~/pod-curious/server.js
mv ~/Downloads/pod-curious-index.html ~/pod-curious/public/index.html
mv ~/Downloads/pod-curious-package.json ~/pod-curious/package.json
```

### 4c: Verify everything is in place

```
ls ~/pod-curious/
```

You should see: `package.json  public  server.js`

```
ls ~/pod-curious/public/
```

You should see: `index.html`

---

## Step 5: Run Pod Curious

Copy this command, but **replace the placeholder keys with your real keys** (do this in Notes first, then paste into Terminal):

```
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE LISTEN_NOTES_KEY=YOUR-LN-KEY-HERE node ~/pod-curious/server.js
```

You should see:

```
  🎧 Pod Curious running at http://localhost:3000
  ✅ Listen Notes API connected
```

Now open your web browser and go to: **http://localhost:3000**

---

## Step 6: Use It!

1. **Paste a podcast link** — from Apple Podcasts, Spotify, YouTube, Overcast, etc.
2. **Read the analysis** — Pod Curious will describe the episode's content, themes, and guest
3. **Refine your playlist** — chat to say what you're in the mood for ("more academic", "include some humor", "focus on the policy side")
4. **Pick a duration** — 30 minutes to 10 hours
5. **Build your playlist** — click "Build my playlist"
6. **Listen** — click the "Listen" button on each episode to open it

---

## Daily Use

Each time you want to use Pod Curious:

1. Open Terminal
2. Run:
```
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE LISTEN_NOTES_KEY=YOUR-LN-KEY-HERE node ~/pod-curious/server.js
```
3. Open **http://localhost:3000** in your browser
4. When done, press **Ctrl + C** in Terminal to stop

### Optional: Save your keys so you don't have to type them every time

Run these once (replace with your real keys):

```
echo 'export ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE' >> ~/.zshrc
echo 'export LISTEN_NOTES_KEY=YOUR-LN-KEY-HERE' >> ~/.zshrc
source ~/.zshrc
```

Then from now on, you can just run:

```
cd ~/pod-curious && node server.js
```

---

## Troubleshooting

### "command not found: node"
Node.js isn't installed. Go back to Step 2.

### "invalid x-api-key"
Your Anthropic API key is wrong or expired. Check https://console.anthropic.com/api-keys and make sure you're using the right key. Make sure there are no extra spaces.

### "Failed to analyze" or app hangs
Press Ctrl + C in Terminal to stop, then try restarting. If the problem persists, try a different podcast link.

### Page says "Not found" at localhost:3000
The `index.html` file is missing from the public folder. Run:
```
ls ~/pod-curious/public/
```
If it's empty, re-download the files and move them again (Step 4b).

### Spotify links don't work
Spotify pages don't always provide episode info. Try sharing an Apple Podcasts link instead — they work most reliably.

---

## Important Notes

- **Keep your API keys private.** Don't share them in group chats or social media.
- **Costs are minimal.** The Anthropic API costs a few cents per playlist. The Listen Notes free plan is free forever.
- **The app runs locally.** Nothing is stored online. When you close Terminal, it stops.

---

*Built with Claude by Anthropic · Listen Notes Podcast API · Node.js*
