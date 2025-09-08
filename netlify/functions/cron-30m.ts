// netlify/functions/cron-30m.ts  (modo prueba: corre cada 1 minuto)
import webpush from "web-push";
import { getBlobStore, getList, setList } from "./_store";

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

// ===== ENV / VAPID / ICONOS =====
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";
const BINANCE_SYMBOL = process.env.BINANCE_SYMBOL || "ETHUSDT"; // último fallback
// Iconos (personalizables). Poné tus archivos en /public/icons/ o seteá las envs:
const ICON_URL = process.env.PUSH_ICON_URL || "/icons/app-192.png";
const BADGE_URL = process.env.PUSH_BADGE_URL || "/icons/badge-72.png";

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
const fmtSigned = (n: number, d = 2) =>
  (n >= 0 ? "+" : "−") + fmt(Math.abs(n), d);

// ---- proveedores de precio (fallbacks) ----
async function fromCoinbase() {
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  if (!r.ok) throw new Error(`coinbase ${r.status}`);
  const j = (await r.json()) as any;
  const p = Number(j?.data?.amount);
  if (!Number.isFinite(p)) throw new Error("coinbase invalid");
  return { price: p, src: "coinbase" };
}
async function fromCoingecko() {
  const r = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
  );
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = (await r.json()) as any;
  const p = Number(j?.ethereum?.usd);
  if (!Number.isFinite(p)) throw new Error("coingecko invalid");
  return { price: p, src: "coingecko" };
}
async function fromKraken() {
  const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSD");
  if (!r.ok) throw new Error(`kraken ${r.status}`);
  const j = (await r.json()) as any;
  const key = j?.result ? Object.keys(j.result)[0] : undefined;
  const p = Number(key ? j.result[key]?.c?.[0] : NaN);
  if (!Number.isFinite(p)) throw new Error("kraken invalid");
  return { price: p, src: "kraken" };
}
async function fromBinance() {
  const r = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${BINANCE_SYMBOL}`
  );
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const j = (await r.json()) as any;
  const p = Number(j?.price);
  if (!Number.isFinite(p)) throw new Error("binance invalid");
  return { price: p, src: "binance" };
}
async function fetchEthPrice() {
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

// ---- posición: orders -> fallback portfolio/eth ----
async function loadPosition(): Promise<{
  qty: number;
  avgPrice: number;
} | null> {
  const orders = (await getList<Order[]>("orders", "list")) || null;
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
  const pf = await getList<PositionFallback>("portfolio", "eth");
  if (pf && Number.isFinite(pf.qty) && Number.isFinite(pf.avgPrice))
    return { qty: pf.qty, avgPrice: pf.avgPrice };
  return null;
}

// ---- cargar subs: list o blobs ----
type LoadedSubs =
  | { source: "list"; subs: Sub[] }
  | { source: "blobs"; subs: { key: string; sub: Sub }[] }
  | { source: "none"; subs: [] };

async function loadSubs(): Promise<LoadedSubs> {
  const list = await getList<Sub[]>("subs", "list");
  const fromList = Array.isArray(list) ? list.filter((s) => !!s?.endpoint) : [];
  if (fromList.length) return { source: "list", subs: fromList };

  const store = getBlobStore("subs");
  const { blobs } = await store.list();
  const arr: { key: string; sub: Sub }[] = [];
  for (const b of blobs) {
    const sub = (await store.get(b.key, { type: "json" })) as Sub | null;
    if (sub?.endpoint) arr.push({ key: b.key, sub });
  }
  if (arr.length) return { source: "blobs", subs: arr };

  return { source: "none", subs: [] };
}

// ---- enviar + limpiar inválidos ----
async function sendAndClean(loaded: LoadedSubs, payload: string) {
  let sent = 0,
    failed = 0,
    cleaned = 0;

  if (loaded.source === "list") {
    const subs = loaded.subs;
    const invalid = new Set<string>();
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(s as any, payload, { TTL: 300 });
          sent++;
        } catch (e: any) {
          failed++;
          const code = e?.statusCode;
          if (code === 404 || code === 410) {
            invalid.add(s.endpoint);
            cleaned++;
          }
          console.error("cron-1m push error", code, e?.body || e?.message);
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
    const store = getBlobStore("subs");
    await Promise.allSettled(
      loaded.subs.map(async ({ key, sub }) => {
        try {
          await webpush.sendNotification(sub as any, payload, { TTL: 300 });
          sent++;
        } catch (e: any) {
          failed++;
          const code = e?.statusCode;
          if (code === 404 || code === 410) {
            await store.delete(key);
            cleaned++;
          }
          console.error("cron-1m push error", code, e?.body || e?.message);
        }
      })
    );
    return { sent, failed, cleaned };
  }

  return { sent, failed, cleaned };
}

// ---- handler (Response) ----
export default async function handler(req: Request): Promise<Response> {
  try {
    assertEnv();
    let debug = false;
    try {
      const url = new URL(req.url);
      debug = url.searchParams.get("debug") === "1";
    } catch {}

    const { price, src } = await fetchEthPrice();
    const position = await loadPosition();
    const qty = position?.qty ?? 0;
    const avg = position?.avgPrice ?? 0;
    const pnl = qty ? (price - avg) * qty : 0;

    // 👉 Lo que pediste: "a cuánto está" y "diferencia neta vs mi orden"
    const title = `ETH $${fmt(price)}`;
    const body = qty
      ? `Δ neta: $${fmtSigned(pnl)} · Qty: ${fmt(qty, 6)} · Orden: $${fmt(avg)}`
      : debug
      ? "Test manual cron-1m ✅"
      : "Guardá tu orden para ver Δ neta";

    const payload = JSON.stringify({
      title,
      body,
      url: "/",
      tag: "eth-1m", // en prod: "eth-30m"
      renotify: true, // en prod: false si no querés sonido cada vez
      icon: ICON_URL, // ← icono “lindo” (tu app)
      badge: BADGE_URL, // ← badge pequeño monocromo
    });

    const loaded = await loadSubs();
    if (loaded.source === "none") {
      return new Response(
        JSON.stringify({
          ok: true,
          note: "no-subs",
          price,
          price_source: src,
          position,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const res = await sendAndClean(loaded, payload);
    const subsCount =
      loaded.source === "list" ? loaded.subs.length : loaded.subs.length;

    return new Response(
      JSON.stringify({
        ok: true,
        price,
        price_source: src,
        position,
        subs: subsCount,
        source: loaded.source,
        ...res,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    console.error("cron-1m fatal:", e?.message || e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e) }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}

// ⏰ cada 1 minuto (para pruebas). Volvé a */30 * * * * en producción.
export const config = { schedule: "* * * * *" };
