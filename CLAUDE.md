# Pod Curious

A Node.js app that builds podcast playlists from any URL — article, Wikipedia page, podcast episode, or any topic.

## Architecture

No dependencies. Pure Node.js using built-in `http`, `https`, `fs`, `path`, and `url` modules.

- **`server.js`** — HTTP server + all backend logic
- **`public/index.html`** — Single-file frontend (HTML + CSS + JS, no build step)

## Running

```bash
ANTHROPIC_API_KEY=sk-ant-... LISTEN_NOTES_KEY=... node server.js
```

Runs on `http://localhost:3000` by default. Set `PORT` to override.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `LISTEN_NOTES_KEY` | Yes | Listen Notes API key for episode search and embedded player |

## API Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/analyze` | Fetches a URL, scrapes metadata, asks Claude to analyze content and suggest a playlist direction |
| `POST /api/chat` | Passes conversation history to Claude for playlist refinement chat |
| `POST /api/playlist` | Claude generates search queries → Listen Notes finds real episodes → Claude curates the best ones |

## User Flow

1. **Step 1** — User pastes any URL
2. **Step 2** — Server scrapes the URL, Claude analyzes it (topics, tone, guest, summary), and opens a chat for refinement. User picks a playlist duration (30 min – 10 hours).
3. **Step 3** — Backend runs 12–15 Claude-generated search queries against Listen Notes, deduplicates results, then asks Claude to curate the best-fit episodes. Playlist renders with inline Listen Notes embedded player.

## Key Implementation Details

- **Spotify URLs** get special handling: tries Listen Notes search first, falls back to Spotify embed page, then oembed API
- **Episode deduplication** is done by Listen Notes episode ID (`Map` keyed on `r.id`)
- **Embedded player** uses `https://www.listennotes.com/embedded/e/{episodeId}/` iframes; only one plays at a time
- **Claude model**: `claude-sonnet-4-20250514` (called directly via HTTPS, no SDK)
- All Claude calls expect raw JSON responses (no markdown fences); the server strips fences and falls back to regex extraction if needed
- Frontend state is a plain JS object (`state`) with no framework

## Frontend Notes

- No build tooling — edit `public/index.html` directly
- CSS custom properties define the design system (warm neutrals, terracotta accent `#C45D3E`)
- Three-step wizard controlled by `showStep(n)` — steps are shown/hidden via `.hidden` class
- `esc()` helper sanitizes all dynamic content before inserting into the DOM
