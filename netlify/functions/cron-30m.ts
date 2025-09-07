// netlify/functions/cron-30m.ts
import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getStore } from "@netlify/blobs";
import { getList, setList } from "./_store";

// ===== Tipos =====
type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };
type Order = {
  side: "buy" | "sell";
  qty: number;
  price: number;
  ts?: number;
  feeUsd?: number;
};
type PositionFallback = { qty: number; avgPrice: number };

// ===== ENV / VAPID =====
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";
const BINANCE_SYMBOL = process.env.BINANCE_SYMBOL || "ETHUSDT"; // solo para el último fallback

function assertEnv() {
  const missing: string[] = [];
  if (!VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
  if (!VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
  if (missing.length) throw new Error("Faltan env vars: " + missing.join(", "));
}

webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ===== Utils =====
const fmt = (n: number, d = 2) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

// --- Fallbacks de precio ---
async function fromCoinbase(): Promise<{ price: number; src: string }> {
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  if (!r.ok) throw new Error(`coinbase ${r.status}`);
  const j = (await r.json()) as { data?: { amount?: string } };
  const p = Number(j?.data?.amount);
  if (!Number.isFinite(p)) throw new Error("coinbase invalid");
  return { price: p, src: "coinbase" };
}
async function fromCoingecko(): Promise<{ price: number; src: string }> {
  const r = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
  );
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j: any = await r.json();
  const p = Number(j?.ethereum?.usd);
  if (!Number.isFinite(p)) throw new Error("coingecko invalid");
  return { price: p, src: "coingecko" };
}
async function fromKraken(): Promise<{ price: number; src: string }> {
  const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSD");
  if (!r.ok) throw new Error(`kraken ${r.status}`);
  const j: any = await r.json();
  const key = j?.result ? Object.keys(j.result)[0] : undefined; // XETHZUSD/ETHUSD
  const p = Number(key ? j.result[key]?.c?.[0] : NaN);
  if (!Number.isFinite(p)) throw new Error("kraken invalid");
  return { price: p, src: "kraken" };
}
async function fromBinance(): Promise<{ price: number; src: string }> {
  const r = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${BINANCE_SYMBOL}`
  );
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const j = (await r.json()) as { price?: string };
  const p = Number(j?.price);
  if (!Number.isFinite(p)) throw new Error("binance invalid");
  return { price: p, src: "binance" };
}
async function fetchEthPrice(): Promise<{ price: number; src: string }> {
  const attempts = [fromCoinbase, fromCoingecko, fromKraken, fromBinance];
  const errors: string[] = [];
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }
  throw new Error("price providers failed: " + errors.join(" | "));
}

// --- Cargar posición: orders -> fallback portfolio/eth ---
async function loadPosition(): Promise<{
  qty: number;
  avgPrice: number;
} | null> {
  const oStore = getStore("orders");
  const orders = (await oStore.get("list", { type: "json" })) as Order[] | null;
  if (orders?.length) {
    let qty = 0,
      cost = 0;
    for (const o of orders) {
      const fee = Number(o.feeUsd || 0);
      if (o.side === "buy") {
        qty += o.qty;
        cost += o.qty * o.price + fee;
      } else if (o.side === "sell") {
        const avg = qty > 0 ? cost / qty : 0;
        qty -= o.qty;
        cost -= avg * o.qty;
        if (qty < 1e-12) {
          qty = 0;
          cost = 0;
        }
      }
    }
    if (qty > 0) return { qty, avgPrice: cost / qty };
  }
  const pf = (await getStore("portfolio").get("eth", {
    type: "json",
  })) as PositionFallback | null;
  if (pf && Number.isFinite(pf.qty) && Number.isFinite(pf.avgPrice))
    return { qty: pf.qty, avgPrice: pf.avgPrice };
  return null;
}

// --- Cargar subs desde list ó blobs ---
type LoadedSubs =
  | { source: "list"; subs: Sub[] }
  | { source: "blobs"; subs: { key: string; sub: Sub }[] }
  | { source: "none"; subs: [] };

async function loadSubs(): Promise<LoadedSubs> {
  // 1) lista: namespace "subs", key "list"
  const list = await getList<Sub[]>("subs", "list");
  const fromList = Array.isArray(list) ? list.filter((s) => !!s?.endpoint) : [];
  if (fromList.length) return { source: "list", subs: fromList };

  // 2) blobs por endpoint: namespace "subs" (un blob por endpoint)
  const store = getStore("subs");
  const { blobs } = await store.list();
  const arr: { key: string; sub: Sub }[] = [];
  for (const b of blobs) {
    const sub = (await store.get(b.key, { type: "json" })) as Sub | null;
    if (sub?.endpoint) arr.push({ key: b.key, sub });
  }
  if (arr.length) return { source: "blobs", subs: arr };

  return { source: "none", subs: [] };
}

// --- Envío y limpieza de inválidos (404/410) ---
async function sendAndClean(loaded: LoadedSubs, payload: string) {
  let sent = 0,
    failed = 0,
    cleaned = 0;

  if (loaded.source === "list") {
    const subs = loaded.subs;
    const invalid = new Set<string>(); // endpoints a remover
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(s as any, payload);
          sent++;
        } catch (e: any) {
          failed++;
          const code = e?.statusCode;
          if (code === 404 || code === 410) {
            invalid.add(s.endpoint);
            cleaned++;
          }
          console.error("cron-30m push error", code, e?.body || e?.message);
        }
      })
    );
    if (invalid.size) {
      const next = subs.filter((s) => !invalid.has(s.endpoint));
      await setList("subs", "list", next);
    }
    return { sent, failed, cleaned };
  }

  if (loaded.source === "blobs") {
    const store = getStore("subs");
    await Promise.allSettled(
      loaded.subs.map(async ({ key, sub }) => {
        try {
          await webpush.sendNotification(sub as any, payload);
          sent++;
        } catch (e: any) {
          failed++;
          const code = e?.statusCode;
          if (code === 404 || code === 410) {
            await store.delete(key);
            cleaned++;
          }
          console.error("cron-30m push error", code, e?.body || e?.message);
        }
      })
    );
    return { sent, failed, cleaned };
  }

  return { sent, failed, cleaned };
}

// ===== Handler =====
export const handler: Handler = async (event) => {
  try {
    assertEnv();
    const debug = event.queryStringParameters?.debug === "1";

    const { price, src } = await fetchEthPrice();
    const position = await loadPosition(); // puede ser null
    const qty = position?.qty ?? 0;
    const avg = position?.avgPrice ?? 0;
    const pnl = qty ? (price - avg) * qty : 0;

    const title = qty
      ? `ETH $${fmt(price)} | Δ $${fmt(pnl)}`
      : `ETH $${fmt(price)}`;
    const body = qty
      ? `Qty: ${fmt(qty, 6)} · Avg: $${fmt(avg)} · PnL: $${fmt(pnl)}`
      : debug
      ? "Test manual cron-30m ✅"
      : "Actualización cada 30 min ✅";

    const payload = JSON.stringify({
      title,
      body,
      url: "/",
      tag: "eth-30m",
      renotify: true,
    });

    const loaded = await loadSubs();
    if (loaded.source === "none") {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          note: "no-subs",
          price,
          price_source: src,
          position,
        }),
      };
    }

    const res = await sendAndClean(loaded, payload);
    const subsCount =
      loaded.source === "list" ? loaded.subs.length : loaded.subs.length;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        price,
        price_source: src,
        position,
        subs: subsCount,
        source: loaded.source,
        ...res,
      }),
    };
  } catch (e: any) {
    console.error("cron-30m fatal:", e?.message || e);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};

// ⏰ cada 30 minutos (UTC)
export const config = { schedule: "* * * * *" };
