const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const LISTEN_NOTES_KEY = process.env.LISTEN_NOTES_KEY || "";

// ─── Helpers ──────────────────────────────────────────────────────────

function fetchURL(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    const parsed = new URL(urlStr);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(urlStr, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 10000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchURL(new URL(res.headers.location, urlStr).toString(), maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

function extractMetadata(html) {
  const get = (regex) => { const m = html.match(regex); return m ? decodeEntities(m[1].trim()) : ""; };
  const getAll = (name) => {
    const regex = new RegExp(`<meta\\s+(?:property|name)=["']${name}["']\\s+content=["']([^"']*)["']`, "gi");
    const alt = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+(?:property|name)=["']${name}["']`, "gi");
    let m = regex.exec(html) || alt.exec(html);
    return m ? decodeEntities(m[1]) : "";
  };
  return {
    title: get(/<title[^>]*>([^<]*)<\/title>/i),
    ogTitle: getAll("og:title"),
    ogDescription: getAll("og:description"),
    ogSiteName: getAll("og:site_name"),
    ogImage: getAll("og:image"),
    description: getAll("description"),
  };
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/").replace(/&mdash;/g, "\u2014").replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "\u2026");
}

function callClaude(messages, system, maxTokens = 2000) {
  return new Promise((resolve, reject) => {
    const payload = { model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages };
    if (system) payload.system = system;
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: {
        "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { console.error("[claude] Error:", parsed.error.message); reject(new Error(parsed.error.message)); }
          else resolve(parsed);
        } catch (e) { console.error("[claude] Raw:", data.slice(0, 300)); reject(new Error("Failed to parse Claude response")); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

function sendJSON(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
    res.end(data);
  });
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Pod Curious, a warm and knowledgeable podcast companion. You help people discover podcasts by analyzing episodes they share and building personalized playlists.

Your personality: curious, enthusiastic but not over-the-top, well-read, like a friend who always has the best podcast recommendations. You speak naturally, not in bullet points.

IMPORTANT: The total duration of playlists matters a lot. Users specify how long they want to listen, and you must build playlists that hit that target. Track running time carefully.`;

// ─── API Routes ───────────────────────────────────────────────────────

async function handleAnalyze(req, res) {
  try {
    const { url } = await parseBody(req);
    if (!url) return sendJSON(res, 400, { error: "Missing URL" });

    console.log(`[analyze] Fetching: ${url}`);

    let podcast = "", episode = "", description = "", image = "";

    // Check if it's a Spotify URL — these need special handling
    const spotifyMatch = url.match(/spotify\.com\/episode\/([a-zA-Z0-9]+)/);
    const spotifyShowMatch = url.match(/spotify\.com\/show\/([a-zA-Z0-9]+)/);

    if (spotifyMatch && LISTEN_NOTES_KEY) {
      // Look up the Spotify episode via Listen Notes
      const spotifyId = spotifyMatch[1];
      console.log(`[analyze] Spotify episode detected: ${spotifyId}, looking up via Listen Notes...`);

      try {
        const lnUrl = `https://listen-api.listennotes.com/api/v2/episodes/${spotifyId}?show_transcript=0`;
        // First try by Spotify ID directly — Listen Notes might not support this on free tier
        // Instead, search for it
        const searchUrl = `https://listen-api.listennotes.com/api/v2/search?q=${spotifyId}&type=episode&sort_by_date=0`;
        const lnResp = await new Promise((resolve, reject) => {
          https.get(searchUrl, { headers: { "X-ListenAPI-Key": LISTEN_NOTES_KEY } }, (r) => {
            let d = ""; r.on("data", c => d += c);
            r.on("end", () => { try { resolve(JSON.parse(d)); } catch { reject(new Error("Parse error")); } });
          }).on("error", reject);
        });

        // If that doesn't work well, try fetching the Spotify page with embed
        if (!lnResp.results || lnResp.results.length === 0) {
          throw new Error("Not found via search");
        }

        const best = lnResp.results[0];
        podcast = best.podcast?.title_original || "";
        episode = best.title_original || "";
        description = best.description_original || "";
        image = best.image || best.thumbnail || "";
        console.log(`[analyze] Listen Notes found: "${episode}" from "${podcast}"`);
      } catch (lnErr) {
        console.log(`[analyze] Listen Notes lookup failed, trying Spotify embed...`);
        // Fallback: try the Spotify embed page which has better metadata
        try {
          const embedUrl = `https://open.spotify.com/embed/episode/${spotifyMatch[1]}`;
          const html = await fetchURL(embedUrl);
          const meta = extractMetadata(html);
          podcast = meta.ogSiteName || "";
          episode = meta.ogTitle || meta.title || "";
          description = meta.ogDescription || meta.description || "";
          image = meta.ogImage || "";
        } catch {
          // Last resort: try the oembed API
          try {
            const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
            const oembedHtml = await fetchURL(oembedUrl);
            const oembedData = JSON.parse(oembedHtml);
            episode = oembedData.title || "";
            podcast = oembedData.provider_name || "Spotify";
            image = oembedData.thumbnail_url || "";
          } catch {
            throw new Error("Could not extract episode info from Spotify link. Try an Apple Podcasts or YouTube link instead.");
          }
        }
      }
    } else {
      // Standard HTML scraping for Apple Podcasts, YouTube, Overcast, etc.
      const html = await fetchURL(url);
      const meta = extractMetadata(html);
      podcast = meta.ogSiteName || "";
      episode = meta.ogTitle || meta.title || "";
      description = meta.ogDescription || meta.description || "";
      image = meta.ogImage || "";
    }

    console.log(`[analyze] Found: "${episode}" from "${podcast}"`);

    if (!episode || episode === "Spotify – Web Player" || episode === "Spotify") {
      return sendJSON(res, 400, { error: "Couldn't identify the episode from that link. Try sharing an Apple Podcasts or YouTube link instead." });
    }

    // Ask Claude to analyze
    const prompt = `Analyze this podcast episode. Respond with ONLY a JSON object — no other text, no explanation, no markdown fences.

Podcast: "${podcast}"
Episode: "${episode}"
Description: "${description}"

Your response must be exactly this JSON structure and nothing else:
{"summary":"A 2-3 sentence description of what this episode covers, its guest, and themes.","guest":"Guest name or null","topics":["topic1","topic2","topic3"],"tone":"e.g. academic, casual, investigative","suggestedPrompt":"A natural language playlist prompt based on this episode, ending by asking how long the playlist should be."}`;

    const claudeResp = await callClaude([{ role: "user", content: prompt }], SYSTEM_PROMPT);
    const text = claudeResp.content?.map(c => c.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch {
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        console.error("[analyze] Claude response was not JSON:", clean.slice(0, 200));
        throw new Error("Could not parse analysis. Please try again.");
      }
    }

    sendJSON(res, 200, {
      podcast, episode, description: description.slice(0, 500), image,
      analysis,
    });
  } catch (err) {
    console.error("[analyze] Error:", err.message);
    sendJSON(res, 500, { error: "Failed to analyze: " + err.message });
  }
}

async function handleChat(req, res) {
  try {
    const { messages } = await parseBody(req);
    if (!messages || !messages.length) return sendJSON(res, 400, { error: "No messages" });

    console.log(`[chat] ${messages.length} messages, last: "${messages[messages.length - 1].content.slice(0, 80)}..."`);

    const claudeResp = await callClaude(messages, SYSTEM_PROMPT);
    const text = claudeResp.content?.map(c => c.text || "").join("") || "";

    sendJSON(res, 200, { reply: text });
  } catch (err) {
    console.error("[chat] Error:", err.message);
    sendJSON(res, 500, { error: "Chat failed: " + err.message });
  }
}

async function handlePlaylist(req, res) {
  try {
    const { prompt, durationMinutes } = await parseBody(req);
    if (!prompt) return sendJSON(res, 400, { error: "Missing prompt" });

    console.log(`[playlist] Generating for: "${prompt.slice(0, 80)}..." (${durationMinutes} min)`);

    const playlistPrompt = `Based on the user's refined request, generate a podcast playlist.

User's playlist request: "${prompt}"
Target total duration: ${durationMinutes} minutes (approximately ${Math.round(durationMinutes / 60 * 10) / 10} hours)

CRITICAL: The episodes must add up to approximately ${durationMinutes} minutes total. Track the running time as you build the list. You can go slightly over but never significantly under.

Respond with JSON only, no markdown:
{
  "playlistTitle": "A catchy, descriptive title for this playlist",
  "playlistDescription": "One sentence describing the listening journey",
  "targetMinutes": ${durationMinutes},
  "episodes": [
    {
      "podcast": "Real podcast name",
      "episode": "Real episode title",
      "guest": "Guest name or null",
      "duration": 45,
      "year": "2024",
      "description": "One sentence on what this episode covers and why it fits the playlist",
      "searchQuery": "concise search query to find this on Listen Notes"
    }
  ],
  "totalMinutes": 0,
  "note": "A brief note about the playlist arc — how the episodes flow together"
}

Rules:
- REAL podcasts and real or representative episode titles only
- "duration" is in minutes and must be realistic for each episode
- The sum of all durations must be close to ${durationMinutes} minutes
- Order episodes in a logical listening sequence
- Each episode from a different podcast when possible
- Include a mix of well-known and lesser-known shows
- "totalMinutes" must equal the actual sum of episode durations`;

    const claudeResp = await callClaude([{ role: "user", content: playlistPrompt }], SYSTEM_PROMPT, 3000);
    const text = claudeResp.content?.map(c => c.text || "").join("") || "";
    const playlist = JSON.parse(text.replace(/```json|```/g, "").trim());

    // Enrich every episode with links
    console.log("[listen-notes] Enriching episodes...");
    for (let ep of playlist.episodes) {
      // If Listen Notes key is available, try to find direct link
      if (LISTEN_NOTES_KEY) {
        try {
          // Use just the podcast name + a few key words from the episode title
          const podcastName = (ep.podcast || "").replace(/[#&"]/g, " ").trim();
          const episodeTitle = (ep.episode || "").replace(/[#&"]/g, " ").trim();
          
          // First try: podcast name + episode title (unquoted, loose match)
          const sq = encodeURIComponent(`${podcastName} ${episodeTitle}`.slice(0, 150));
          const lnUrl = `https://listen-api.listennotes.com/api/v2/search?q=${sq}&type=episode&sort_by_date=0`;

          console.log(`[listen-notes] Searching: ${podcastName} — ${episodeTitle}`);

          const lnResp = await new Promise((resolve, reject) => {
            https.get(lnUrl, { headers: { "X-ListenAPI-Key": LISTEN_NOTES_KEY } }, (r) => {
              let d = ""; r.on("data", c => d += c);
              r.on("end", () => {
                try { resolve(JSON.parse(d)); }
                catch { console.error("[listen-notes] Parse error, raw:", d.slice(0, 200)); reject(new Error("Parse error")); }
              });
            }).on("error", reject);
          });

          if (lnResp.results && lnResp.results.length > 0) {
            // Score each result to find the best match
            let best = null;
            let bestScore = -1;
            const targetTitle = episodeTitle.toLowerCase();
            const targetPodcast = podcastName.toLowerCase();

            for (const r of lnResp.results) {
              const rTitle = (r.title_original || "").toLowerCase();
              const rPodcast = (r.podcast?.title_original || "").toLowerCase();
              let score = 0;

              // Exact title match is best
              if (rTitle === targetTitle) score += 100;
              // Title contains target or vice versa
              else if (rTitle.includes(targetTitle) || targetTitle.includes(rTitle)) score += 50;
              // Shared words
              else {
                const targetWords = targetTitle.split(/\s+/).filter(w => w.length > 3);
                const matchedWords = targetWords.filter(w => rTitle.includes(w));
                score += matchedWords.length * 5;
              }

              // Podcast name match bonus
              if (rPodcast.includes(targetPodcast) || targetPodcast.includes(rPodcast)) score += 30;

              if (score > bestScore) { bestScore = score; best = r; }
            }

            if (best && bestScore >= 10) {
              ep.listenNotesUrl = best.listennotes_url || null;
              ep.listenNotesAudio = best.audio || null;
              ep.listenNotesImage = best.image || best.thumbnail || null;
              ep.listenNotesId = best.id || null;
              console.log(`[listen-notes] ✅ Found (score ${bestScore}): "${best.title_original}" from "${best.podcast?.title_original}" → ${best.listennotes_url}`);
            } else {
              console.log(`[listen-notes] ❌ No good match for: "${episodeTitle}" (best score: ${bestScore})`);
            }
          } else {
            console.log(`[listen-notes] ❌ No results for: "${episodeTitle}"`);
          }
        } catch (err) {
          console.error(`[listen-notes] Error for "${ep.episode}":`, err.message);
        }
      }
    }

    console.log(`[playlist] Generated ${playlist.episodes?.length} episodes, ~${playlist.totalMinutes} min`);
    sendJSON(res, 200, playlist);
  } catch (err) {
    console.error("[playlist] Error:", err.message);
    sendJSON(res, 500, { error: "Failed to generate playlist: " + err.message });
  }
}

// ─── Server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (req.method === "POST" && pathname === "/api/analyze") return handleAnalyze(req, res);
  if (req.method === "POST" && pathname === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && pathname === "/api/playlist") return handlePlaylist(req, res);
  serveStatic(res, path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname));
});

server.listen(PORT, () => {
  console.log(`\n  🎧 Pod Curious running at http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) console.log("  ⚠️  No ANTHROPIC_API_KEY set");
  if (LISTEN_NOTES_KEY) console.log("  ✅ Listen Notes API connected");
  else console.log("  ℹ️  No LISTEN_NOTES_KEY — using platform search links");
  console.log("");
});
