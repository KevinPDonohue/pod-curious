const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const LISTEN_NOTES_KEY = process.env.LISTEN_NOTES_KEY || "";
const PODCASTINDEX_KEY = process.env.PODCASTINDEX_KEY || "";
const PODCASTINDEX_SECRET = process.env.PODCASTINDEX_SECRET || "";
const MONGODB_URI = process.env.MONGODB_URI || "";

// ─── MongoDB ──────────────────────────────────────────────────────────
let db = null;

async function connectDB() {
  if (!MONGODB_URI) return;
  try {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db("podcurious");
    console.log("  ✅ MongoDB connected");
  } catch (err) {
    console.error("  ⚠️  MongoDB connection failed:", err.message);
  }
}

function randomId(len = 8) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function savePlaylist(playlist, prompt, location) {
  if (!db) return null;
  try {
    let id = randomId();
    // Ensure unique ID
    for (let i = 0; i < 5; i++) {
      const existing = await db.collection("playlists").findOne({ id });
      if (!existing) break;
      id = randomId();
    }
    await db.collection("playlists").insertOne({
      id, prompt, location,
      ...playlist,
      createdAt: new Date(),
    });
    return id;
  } catch (err) {
    console.error("[db] Save failed:", err.message);
    return null;
  }
}

async function getPlaylist(id) {
  if (!db) return null;
  try {
    return await db.collection("playlists").findOne({ id });
  } catch { return null; }
}

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

const SYSTEM_PROMPT = `You are Pod Curious, a warm and knowledgeable podcast companion. You help people discover podcasts by analyzing content they share — podcast episodes, news articles, Wikipedia pages, blog posts, or any topic — and building personalized playlists.

Your personality: curious, enthusiastic but not over-the-top, well-read, like a friend who always has the best podcast recommendations. You speak naturally, not in bullet points.

IMPORTANT: The total duration of playlists matters a lot. Users specify how long they want to listen, and you must build playlists that hit that target. Track running time carefully.`;

// ─── Geo lookup ───────────────────────────────────────────────────────

function getIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

async function getLocation(ip) {
  // Skip private/loopback IPs
  if (!ip || ip === "unknown" || ip.startsWith("127.") || ip.startsWith("::1") || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return "local";
  }
  return new Promise((resolve) => {
    https.get(`https://ipapi.co/${ip}/json/`, { headers: { "User-Agent": "PodCurious/1.0" } }, (r) => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => {
        try {
          const data = JSON.parse(d);
          if (data.city && data.country_name) resolve(`${data.city}, ${data.country_name}`);
          else if (data.country_name) resolve(data.country_name);
          else resolve("unknown");
        } catch { resolve("unknown"); }
      });
    }).on("error", () => resolve("unknown"));
  });
}

// ─── API Routes ───────────────────────────────────────────────────────

async function handleAnalyze(req, res) {
  try {
    const { url } = await parseBody(req);
    if (!url) return sendJSON(res, 400, { error: "Missing URL" });

    const ip = getIP(req);
    const location = await getLocation(ip);
    console.log(`[analyze] ${location} — fetching: ${url}`);

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
      return sendJSON(res, 400, { error: "Couldn't extract content from that link. Try a different URL." });
    }

    // Detect content type from URL and metadata
    const urlLower = url.toLowerCase();
    const isPodcast = urlLower.includes("podcast") || urlLower.includes("spotify.com/episode") || urlLower.includes("overcast.fm") || urlLower.includes("podcasts.apple.com");
    const isWikipedia = urlLower.includes("wikipedia.org");
    const contentType = isPodcast ? "podcast episode" : isWikipedia ? "Wikipedia article" : "article";

    // Ask Claude to analyze
    const prompt = `Analyze this ${contentType}. Respond with ONLY a JSON object — no other text, no explanation, no markdown fences.

Source: "${podcast}"
Title: "${episode}"
Description: "${description}"
Content type: ${contentType}

Your response must be exactly this JSON structure and nothing else:
{"summary":"A 2-3 sentence description of what this ${contentType} covers, its key themes, and what makes it interesting.","guest":"Key person mentioned or null","topics":["topic1","topic2","topic3"],"tone":"e.g. academic, casual, investigative","contentType":"${contentType}","suggestedPrompt":"A natural language playlist prompt suggesting podcasts related to this ${contentType}. Reference specific themes from the content and ask how long the playlist should be."}`;

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
      contentType,
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

    const ip = getIP(req);
    const location = await getLocation(ip);
    console.log(`[chat] ${location} — ${messages.length} messages, last: "${messages[messages.length - 1].content.slice(0, 80)}..."`);

    const claudeResp = await callClaude(messages, SYSTEM_PROMPT);
    const text = claudeResp.content?.map(c => c.text || "").join("") || "";

    sendJSON(res, 200, { reply: text });
  } catch (err) {
    console.error("[chat] Error:", err.message);
    sendJSON(res, 500, { error: "Chat failed: " + err.message });
  }
}

async function searchPodcasts(query, { publishedAfter = null } = {}) {
  // Use PodcastIndex if available, fall back to Listen Notes
  if (PODCASTINDEX_KEY && PODCASTINDEX_SECRET) {
    return searchPodcastIndex(query, { publishedAfter });
  } else if (LISTEN_NOTES_KEY) {
    return searchListenNotes(query, { publishedAfter });
  }
  return { results: [] };
}

async function searchPodcastIndex(query, { publishedAfter = null } = {}) {
  const sq = encodeURIComponent(query.slice(0, 150));
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const crypto = require("crypto");
  const hash = crypto.createHash("sha1")
    .update(PODCASTINDEX_KEY + PODCASTINDEX_SECRET + apiHeaderTime)
    .digest("hex");

  let url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${sq}&max=10&fulltext=true`;
  if (publishedAfter) url += `&since=${publishedAfter}`;

  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        "User-Agent": "PodCurious/1.0",
        "X-Auth-Key": PODCASTINDEX_KEY,
        "X-Auth-Date": String(apiHeaderTime),
        "Authorization": hash,
      }
    }, (r) => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => {
        try {
          const parsed = JSON.parse(d);
          // PodcastIndex returns feeds, not episodes — use episode search instead
          // Map to a common format
          const feeds = parsed.feeds || [];
          resolve({ _feeds: feeds, results: [] });
        } catch { resolve({ results: [] }); }
      });
    }).on("error", () => resolve({ results: [] }));
  });
}

async function searchPodcastIndexEpisodes(query, { publishedAfter = null } = {}) {
  const sq = encodeURIComponent(query.slice(0, 150));
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const crypto = require("crypto");
  const hash = crypto.createHash("sha1")
    .update(PODCASTINDEX_KEY + PODCASTINDEX_SECRET + apiHeaderTime)
    .digest("hex");

  let url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${sq}&max=5`;
  if (publishedAfter) url += `&since=${publishedAfter}`;

  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        "User-Agent": "PodCurious/1.0",
        "X-Auth-Key": PODCASTINDEX_KEY,
        "X-Auth-Date": String(apiHeaderTime),
        "Authorization": hash,
      }
    }, (r) => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ items: [] }); }
      });
    }).on("error", () => resolve({ items: [] }));
  });
}

async function searchListenNotes(query, { sortByDate = false, publishedAfter = null } = {}) {
  const sq = encodeURIComponent(query.slice(0, 150));
  let lnUrl = `https://listen-api.listennotes.com/api/v2/search?q=${sq}&type=episode&sort_by_date=${sortByDate ? 1 : 0}&len_min=10`;
  if (publishedAfter) lnUrl += `&published_after=${publishedAfter}`;
  return new Promise((resolve) => {
    https.get(lnUrl, { headers: { "X-ListenAPI-Key": LISTEN_NOTES_KEY } }, (r) => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ results: [] }); } });
    }).on("error", () => resolve({ results: [] }));
  });
}

async function handlePlaylist(req, res) {
  try {
    const { prompt, durationMinutes } = await parseBody(req);
    if (!prompt) return sendJSON(res, 400, { error: "Missing prompt" });

    const ip = getIP(req);
    const location = await getLocation(ip);
    console.log(`[playlist] ${location} — generating for: "${prompt.slice(0, 80)}..." (${durationMinutes} min)`);

    // STEP 1: Ask Claude for search queries, not episode titles
    const queryPrompt = `Based on the user's request, generate search queries to find relevant podcast episodes.

Today's date is ${new Date().toISOString().split("T")[0]}.

User's request: "${prompt}"
Target total duration: ${durationMinutes} minutes

Generate 12-15 diverse search queries that would find podcast episodes related to this topic. Each query should be 3-6 words, specific enough to find relevant episodes but general enough to return results.

Also detect whether the user wants recent episodes. Set "recentBias" to true if they mention words like "recent", "latest", "new", "current", "today", "this year", or a specific recent year. If recentBias is true, set "publishedAfterYear" to the earliest year they'd accept (e.g. 2024 if they want "recent", or a specific year if they mention one).

Respond with JSON only, no markdown:
{
  "queries": ["query 1", "query 2", "query 3"],
  "playlistTitle": "A catchy title for this playlist",
  "playlistDescription": "One sentence describing the listening journey",
  "recentBias": false,
  "publishedAfterYear": null
}

Rules:
- Queries should cover different angles/subtopics of the user's interest
- Mix broad queries ("CIA history podcast") with specific ones ("bay of pigs intelligence failure")
- Include queries with well-known podcast names when relevant (e.g. "Radiolab CIA", "Fresh Air intelligence")
- Include queries about people, events, and themes related to the topic
- CONTENT QUALITY: Only search for reputable, mainstream content. No conspiracy theories or fringe sources.`;

    const queryResp = await callClaude([{ role: "user", content: queryPrompt }], SYSTEM_PROMPT, 1500);
    const queryText = queryResp.content?.map(c => c.text || "").join("") || "";
    let queryData;
    try {
      queryData = JSON.parse(queryText.replace(/```json|```/g, "").trim());
    } catch {
      const m = queryText.match(/\{[\s\S]*\}/);
      queryData = m ? JSON.parse(m[0]) : { queries: [], playlistTitle: "Podcast Playlist", playlistDescription: "" };
    }

    const queries = queryData.queries || [];
    const recentBias = !!queryData.recentBias;
    const publishedAfterYear = queryData.publishedAfterYear || null;
    const publishedAfter = publishedAfterYear ? Math.floor(new Date(`${publishedAfterYear}-01-01`).getTime() / 1000) : null;
    if (recentBias) console.log(`[playlist] Recency bias: on, after ${publishedAfterYear}`);
    console.log(`[playlist] Claude generated ${queries.length} search queries`);

    // STEP 2: Search for episodes
    const allEpisodes = new Map(); // deduplicate by episode ID
    const usePodcastIndex = !!(PODCASTINDEX_KEY && PODCASTINDEX_SECRET);
    const useListenNotes = !!LISTEN_NOTES_KEY;

    if (!usePodcastIndex && !useListenNotes) {
      console.log("[playlist] No podcast search API configured");
    }

    for (const query of queries) {
      if (!usePodcastIndex && !useListenNotes) break;
      console.log(`[search] "${query}"`);
      try {
        if (usePodcastIndex) {
          // PodcastIndex: search episodes directly
          const crypto = require("crypto");
          const apiHeaderTime = Math.floor(Date.now() / 1000);
          const hash = crypto.createHash("sha1")
            .update(PODCASTINDEX_KEY + PODCASTINDEX_SECRET + apiHeaderTime)
            .digest("hex");
          const sq = encodeURIComponent(query.slice(0, 150));
          let epUrl = `https://api.podcastindex.org/api/1.0/search/byterm?q=${sq}&max=5`;

          const piResp = await new Promise((resolve) => {
            https.get(epUrl, {
              headers: {
                "User-Agent": "PodCurious/1.0",
                "X-Auth-Key": PODCASTINDEX_KEY,
                "X-Auth-Date": String(apiHeaderTime),
                "Authorization": hash,
              }
            }, (r) => {
              let d = ""; r.on("data", c => d += c);
              r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ feeds: [] }); } });
            }).on("error", () => resolve({ feeds: [] }));
          });

          // PodcastIndex search/byterm returns feeds — get recent episodes from each feed
          const feeds = (piResp.feeds || []).slice(0, 2);
          for (const feed of feeds) {
            if (!feed.id) continue;
            // Fetch recent episodes from this feed
            const apiHeaderTime2 = Math.floor(Date.now() / 1000);
            const hash2 = crypto.createHash("sha1")
              .update(PODCASTINDEX_KEY + PODCASTINDEX_SECRET + apiHeaderTime2)
              .digest("hex");
            let epFeedUrl = `https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feed.id}&max=3`;
            if (publishedAfter) epFeedUrl += `&since=${publishedAfter}`;

            const epResp = await new Promise((resolve) => {
              https.get(epFeedUrl, {
                headers: {
                  "User-Agent": "PodCurious/1.0",
                  "X-Auth-Key": PODCASTINDEX_KEY,
                  "X-Auth-Date": String(apiHeaderTime2),
                  "Authorization": hash2,
                }
              }, (r) => {
                let d = ""; r.on("data", c => d += c);
                r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ items: [] }); } });
              }).on("error", () => resolve({ items: [] }));
            });

            for (const ep of (epResp.items || []).slice(0, 3)) {
              const epId = String(ep.id);
              if (!allEpisodes.has(epId)) {
                allEpisodes.set(epId, {
                  listenNotesId: null,
                  listenNotesUrl: null,
                  audioUrl: ep.enclosureUrl || null,
                  listenNotesImage: ep.image || feed.image || null,
                  lnTitle: ep.title || "",
                  lnDescription: (ep.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
                  lnPodcast: feed.title || "",
                  lnPodcastImage: feed.image || null,
                  lnPublisher: feed.author || null,
                  lnPubDate: ep.datePublished ? new Date(ep.datePublished * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null,
                  lnAudioLength: ep.duration ? Math.round(ep.duration / 60) : null,
                  searchQuery: query,
                });
              }
            }
          }
        } else if (useListenNotes) {
          const lnResp = await searchListenNotes(query, { sortByDate: recentBias, publishedAfter });
          if (lnResp.results) {
            for (const r of lnResp.results.slice(0, 3)) {
              if (r.id && !allEpisodes.has(r.id)) {
                allEpisodes.set(r.id, {
                  listenNotesId: r.id,
                  listenNotesUrl: r.listennotes_url || null,
                  audioUrl: r.audio || null,
                  listenNotesImage: r.image || r.thumbnail || null,
                  lnTitle: r.title_original || "",
                  lnDescription: (r.description_original || "").replace(/<[^>]*>/g, "").slice(0, 300),
                  lnPodcast: r.podcast?.title_original || "",
                  lnPodcastImage: r.podcast?.image || r.podcast?.thumbnail || null,
                  lnPublisher: r.podcast?.publisher_original || null,
                  lnPubDate: r.pub_date_ms ? new Date(r.pub_date_ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null,
                  lnAudioLength: r.audio_length_sec ? Math.round(r.audio_length_sec / 60) : null,
                  searchQuery: query,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error(`[search] Error for "${query}":`, err.message);
      }
    }

    const candidates = Array.from(allEpisodes.values());
    console.log(`[playlist] Found ${candidates.length} unique episodes`);

    if (candidates.length === 0) {
      return sendJSON(res, 200, {
        playlistTitle: queryData.playlistTitle || "Podcast Playlist",
        playlistDescription: queryData.playlistDescription || "",
        episodes: [],
        totalMinutes: 0,
        note: "No episodes found. Try broadening your topic.",
      });
    }

    // STEP 3: Ask Claude to curate the best episodes from the real results
    const candidateList = candidates.map((ep, i) => 
      `${i + 1}. "${ep.lnTitle}" from "${ep.lnPodcast}" (${ep.lnAudioLength || "?"} min) — ${ep.lnDescription.slice(0, 150)}`
    ).join("\n");

    const curatePrompt = `Here are real podcast episodes found on the topic. Pick the best ones for a ${durationMinutes}-minute playlist.

User's request: "${prompt}"
Target duration: ${durationMinutes} minutes

Available episodes:
${candidateList}

Select episodes that:
1. Best match the user's interest
2. Add up to approximately ${durationMinutes} minutes total
3. Come from different podcasts when possible
4. Flow well together as a listening sequence
5. Are from reputable, mainstream sources

Respond with JSON only, no markdown:
{
  "selectedIndices": [1, 5, 8, 12],
  "note": "Brief note about how these episodes flow together"
}

Just return the episode numbers from the list above. Pick enough to fill ${durationMinutes} minutes.`;

    const curateResp = await callClaude([{ role: "user", content: curatePrompt }], SYSTEM_PROMPT, 1000);
    const curateText = curateResp.content?.map(c => c.text || "").join("") || "";
    let curateData;
    try {
      curateData = JSON.parse(curateText.replace(/```json|```/g, "").trim());
    } catch {
      const m = curateText.match(/\{[\s\S]*\}/);
      curateData = m ? JSON.parse(m[0]) : { selectedIndices: [], note: "" };
    }

    // Build final playlist from selected indices
    const selectedEps = (curateData.selectedIndices || [])
      .map(idx => candidates[idx - 1])
      .filter(Boolean);

    // Map to the format the frontend expects
    const finalEpisodes = selectedEps.map(ep => ({
      ...ep,
      podcast: ep.lnPodcast,
      episode: ep.lnTitle,
      duration: ep.lnAudioLength || 30,
      description: ep.lnDescription,
    }));

    const totalMinutes = finalEpisodes.reduce((sum, ep) => sum + (ep.lnAudioLength || ep.duration || 0), 0);

    console.log(`[playlist] Final: ${finalEpisodes.length} episodes, ~${totalMinutes} min`);

    const playlistData = {
      playlistTitle: queryData.playlistTitle || "Podcast Playlist",
      playlistDescription: queryData.playlistDescription || "",
      episodes: finalEpisodes,
      totalMinutes,
      note: curateData.note || "",
    };

    const shareId = await savePlaylist(playlistData, prompt, location);
    if (shareId) console.log(`[playlist] Saved as ${shareId}`);

    sendJSON(res, 200, { ...playlistData, shareId });
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

  // Serve shared playlist page
  if (req.method === "GET" && pathname.startsWith("/p/")) {
    const id = pathname.slice(3);
    const playlist = await getPlaylist(id);
    if (!playlist) { res.writeHead(404); res.end("Playlist not found"); return; }
    sendJSON(res, 200, playlist);
    return;
  }

  serveStatic(res, path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname));
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`\n  🎧 Pod Curious running at http://localhost:${PORT}`);
  console.log(`  📱 On your phone: http://0.0.0.0:${PORT} (use your Mac's IP)`);
  if (!ANTHROPIC_API_KEY) console.log("  ⚠️  No ANTHROPIC_API_KEY set");
  if (PODCASTINDEX_KEY && PODCASTINDEX_SECRET) console.log("  ✅ PodcastIndex API connected");
  else if (LISTEN_NOTES_KEY) console.log("  ✅ Listen Notes API connected");
  else console.log("  ⚠️  No podcast search API configured (set PODCASTINDEX_KEY + PODCASTINDEX_SECRET)");
  await connectDB();
  console.log("");
});
