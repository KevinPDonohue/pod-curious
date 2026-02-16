# pod-curious
Share a podcast episode. Build a playlist around it.
Here's the README text — copy it all:

---

# Pod Curious

**Share a podcast episode. Build a playlist around it.**

Pod Curious analyzes podcast episodes you share and builds personalized playlists based on the themes, guests, and topics it finds.

## What You'll Need

- A Mac (these instructions are for macOS)
- About 10 minutes
- A credit/debit card (for API keys — costs are minimal, ~$0.01–0.03 per use)

## Step 1: Open Terminal

Terminal is a built-in app on your Mac.

1. Press **⌘ Cmd + Space** to open Spotlight
2. Type **Terminal**
3. Press **Enter**

## Step 2: Check if Node.js is Installed

Type this in Terminal and press Enter:

```
node --version
```

If you see a version number (like `v18.17.0` or higher) — skip to Step 3.

If you see "command not found":

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the green button)
3. Open the downloaded file and follow the installer
4. Close Terminal completely and reopen it
5. Run `node --version` again to confirm

## Step 3: Get Your API Keys

### Anthropic API Key (required — powers the AI)

1. Go to **https://console.anthropic.com**
2. Create an account (or sign in)
3. Go to **Settings → Billing** and add a payment method
4. Go to **API Keys** and click **Create Key**
5. Copy the key — it starts with `sk-ant-...`
6. Save it somewhere safe (like Notes)

Cost: Each playlist generation costs about $0.01–0.03.

### Listen Notes API Key (recommended — finds episode links)

1. Go to **https://www.listennotes.com/api/pricing/**
2. Click **Subscribe** under the **Free** plan
3. Sign in with Google, Facebook, or Twitter
4. Go to your **API Dashboard** at https://www.listennotes.com/api/dashboard/
5. Copy your API key

Cost: Free plan — 300 requests/month, no credit card needed.

## Step 4: Download and Set Up

### Clone this repo

```
git clone https://github.com/YOURUSERNAME/pod-curious.git
```

### Verify the files

```
ls ~/pod-curious/
```

You should see: `README.md  package.json  public  server.js`

```
ls ~/pod-curious/public/
```

You should see: `index.html`

## Step 5: Run Pod Curious

Replace the placeholder keys with your real keys:

```
cd ~/pod-curious
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE LISTEN_NOTES_KEY=YOUR-LN-KEY-HERE node server.js
```

You should see:

```
  🎧 Pod Curious running at http://localhost:3000
  ✅ Listen Notes API connected
```

Open your browser and go to **http://localhost:3000**

## How to Use

1. **Paste a podcast link** — from Apple Podcasts, Spotify, YouTube, Overcast, etc.
2. **Read the analysis** — Pod Curious describes the episode's content, themes, and guest
3. **Refine your playlist** — chat to say what you want ("more academic", "include some humor", "focus on policy")
4. **Pick a duration** — 30 minutes to 10 hours
5. **Build your playlist** — click "Build my playlist"
6. **Listen** — click the "Listen" button on each episode to open it

## Daily Use

Each time you want to use Pod Curious:

1. Open Terminal
2. Run:
```
cd ~/pod-curious
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE LISTEN_NOTES_KEY=YOUR-LN-KEY-HERE node server.js
```
3. Open **http://localhost:3000**
4. When done, press **Ctrl + C** in Terminal to stop

### Save your keys so you don't have to type them every time

Run these once (replace with your real keys):

```
echo 'export ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE' >> ~/.zshrc
echo 'export LISTEN_NOTES_KEY=YOUR-LN-KEY-HERE' >> ~/.zshrc
source ~/.zshrc
```

Then from now on, just run:

```
cd ~/pod-curious && node server.js
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: node` | Install Node.js from https://nodejs.org |
| `invalid x-api-key` | Check your Anthropic key at https://console.anthropic.com/api-keys |
| Page says "Not found" | Make sure `index.html` is in the `public` folder |
| Spotify links don't work | Try Apple Podcasts links instead — they work most reliably |
| App hangs or errors | Press Ctrl + C, then restart the server |

## Important Notes

- **Keep your API keys private.** Don't share them in group chats or social media.
- **The app runs locally.** Nothing is stored online. When you close Terminal, it stops.

---

*Built with Claude by Anthropic · Listen Notes Podcast API · Node.js*
