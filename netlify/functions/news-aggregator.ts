import type { Handler } from "@netlify/functions";

// Fuentes (RSS públicos; Node puede hacer fetch cross-origin)
const FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", tag: "crypto" },
  { url: "https://cointelegraph.com/rss", tag: "crypto" },
  { url: "https://www.reuters.com/markets/us/rss", tag: "macro" },
  {
    url: "https://www.bloomberg.com/feeds/bbiz/sitemap_news.xml",
    tag: "macro",
  }, // tiene items con <url><lastmod> (vamos a intentar extraer títulos si aparecen)
];

const POS = [
  "bull",
  "bullish",
  "surge",
  "rally",
  "soars",
  "jumps",
  "beats",
  "optimism",
  "approval",
  "etf inflow",
  "record high",
  "buying",
  "accumulate",
  "growth",
  "expands",
  "strong",
  "rebound",
  "recovery",
  "positive",
];
const NEG = [
  "bear",
  "bearish",
  "slump",
  "plunge",
  "falls",
  "sinks",
  "misses",
  "outflow",
  "ban",
  "probe",
  "lawsuit",
  "hack",
  "exploit",
  "regulatory action",
  "tightening",
  "crackdown",
  "selloff",
  "liquidation",
  "negative",
];

// util: corta HTML y normaliza
function clean(s: string) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// extracción ultra-simple de items RSS/XML (título + fecha + fuente)
function parseItems(xml: string, source: string) {
  const items: { title: string; published: number; source: string }[] = [];
  const feed = xml || "";
  // 1) RSS <item>…</item>
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const itemsRaw = feed.match(itemRegex) || [];
  for (const block of itemsRaw) {
    const t = clean(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const d =
      block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ||
      block.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] ||
      block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1] ||
      "";
    const ts = d ? Date.parse(d) : Date.now();
    if (t) items.push({ title: t, published: ts, source });
  }

  // 2) Algunos sitemaps/news usan <url><news:title>…</news:title></url>
  if (items.length === 0) {
    const urlBlocks = feed.match(/<url>[\s\S]*?<\/url>/gi) || [];
    for (const block of urlBlocks) {
      const t =
        clean(
          block.match(/<news:title>([\s\S]*?)<\/news:title>/i)?.[1] ||
            block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
            ""
        ) || "";
      const d =
        block.match(
          /<news:publication_date>([\s\S]*?)<\/news:publication_date>/i
        )?.[1] ||
        block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1] ||
        "";
      const ts = d ? Date.parse(d) : Date.now();
      if (t) items.push({ title: t, published: ts, source });
    }
  }

  return items;
}

function scoreTitle(title: string) {
  const s = title.toLowerCase();
  let score = 0;
  for (const w of POS) if (s.includes(w)) score += 1;
  for (const w of NEG) if (s.includes(w)) score -= 1;
  return score;
}

function verdictFromScore(score: number) {
  if (score > 1) return "Alcista" as const;
  if (score < -1) return "Bajista" as const;
  return "Mixto/Neutro" as const;
}

export const handler: Handler = async () => {
  try {
    const now = Date.now();
    const results = await Promise.allSettled(
      FEEDS.map(async (f) => {
        const r = await fetch(f.url);
        const txt = await r.text();
        return parseItems(txt, new URL(f.url).hostname);
      })
    );

    let items: { title: string; published: number; source: string }[] = [];
    for (const it of results) {
      if (it.status === "fulfilled") items = items.concat(it.value);
    }

    // nos quedamos con últimos 10 días
    const TEN_D = 10 * 24 * 60 * 60 * 1000;
    items = items
      .filter((i) => now - i.published <= TEN_D)
      .sort((a, b) => b.published - a.published);

    // scorings por ventana temporal
    const DAY_3 = 3 * 24 * 60 * 60 * 1000;
    const last3d = items.filter((i) => now - i.published <= DAY_3);
    const last10d = items; // ya filtrado

    // puntajes
    const sumScore = (arr: typeof items) =>
      arr.reduce((acc, x) => acc + scoreTitle(x.title), 0);

    const sShort = sumScore(last3d);
    const sMed = sumScore(last10d);

    // confianza simple: |score| normalizado por √n (robustez)
    const confOf = (arr: typeof items, s: number) => {
      const n = Math.max(1, arr.length);
      const raw = Math.min(1, Math.abs(s) / Math.sqrt(n)); // 0..1
      return Math.round(raw * 100);
    };

    const shortTerm = {
      verdict: verdictFromScore(sShort),
      confidence: confOf(last3d, sShort),
      reasons: (last3d.slice(0, 5) || []).map((h) => h.title),
    };
    const mediumTerm = {
      verdict: verdictFromScore(sMed),
      confidence: confOf(last10d, sMed),
      reasons: (last10d.slice(0, 5) || []).map((h) => h.title),
    };

    // una muestra breve
    const sampleHeadlines = items.slice(0, 2).map((x) => ({
      title: x.title,
      source: x.source.replace(/^www\./, ""),
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        updatedAt: now,
        shortTerm,
        mediumTerm,
        sampleHeadlines,
      }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e?.message || "failed" }),
    };
  }
};
