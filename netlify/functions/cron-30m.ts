import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getStore } from "@netlify/blobs";
import { getList } from "./_store"; // ya lo tenés

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };
type Order = {
  side: "buy" | "sell";
  qty: number;
  price: number;
  ts?: number;
  feeUsd?: number;
};
type PositionFallback = { qty: number; avgPrice: number };

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";
const SYMBOL = process.env.BINANCE_SYMBOL || "ETHUSDT"; // ETH/USDT por defecto

webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const fmt = (n: number, d = 2) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

async function fetchEthPrice(): Promise<number> {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${SYMBOL}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`binance ${r.status} ${r.statusText}`);
  const j = (await r.json()) as { price: string };
  const p = Number(j.price);
  if (!Number.isFinite(p)) throw new Error("Precio inválido");
  return p;
}

// === Cargar subs desde cualquiera de las dos estructuras ===
async function loadSubs(): Promise<{
  subs: Sub[];
  source: "list" | "blobs" | "none";
}> {
  // 1) lista: namespace "subs", key "list" (lo que usa save-subscription.ts)
  const list = await getList<Sub[]>("subs", "list");
  const fromList = Array.isArray(list) ? list.filter((s) => !!s?.endpoint) : [];

  if (fromList.length) return { subs: fromList, source: "list" };

  // 2) blobs por endpoint (lo que usamos en el proyecto anterior)
  const store = getStore("subs");
  const { blobs } = await store.list();
  const arr: Sub[] = [];
  for (const b of blobs) {
    const sub = (await store.get(b.key, { type: "json" })) as Sub | null;
    if (sub?.endpoint) arr.push(sub);
  }
  if (arr.length) return { subs: arr, source: "blobs" };

  return { subs: [], source: "none" };
}

// === Cargar posición: orders -> fallback portfolio/eth ===
async function loadPosition(): Promise<{
  qty: number;
  avgPrice: number;
} | null> {
  // 1) desde ordenes
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
  // 2) fallback: portfolio/eth
  const pf = (await getStore("portfolio").get("eth", {
    type: "json",
  })) as PositionFallback | null;
  if (pf && Number.isFinite(pf.qty) && Number.isFinite(pf.avgPrice))
    return { qty: pf.qty, avgPrice: pf.avgPrice };
  return null;
}

async function sendAll(subs: Sub[], payload: string) {
  const store = getStore("subs");
  let sent = 0,
    failed = 0,
    cleaned = 0;

  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s as any, payload);
        sent++;
      } catch (e: any) {
        failed++;
        const code = e?.statusCode;
        // si tu storage es "list", no podemos borrar selectivamente acá;
        // igual devolvemos info para que investigues.
        if (code === 404 || code === 410) cleaned++;
        console.error("cron-eth-30m push error", code, e?.body || e?.message);
      }
    })
  );

  return { sent, failed, cleaned };
}

export const handler: Handler = async (event) => {
  try {
    const debug = event.queryStringParameters?.debug === "1";
    const { subs, source } = await loadSubs();

    const price = await fetchEthPrice();
    const position = await loadPosition();
    const qty = position?.qty ?? 0;
    const avg = position?.avgPrice ?? 0;
    const pnl = qty ? (price - avg) * qty : 0;

    const title = qty
      ? `ETH $${fmt(price)} | Δ $${fmt(pnl)}`
      : `ETH $${fmt(price)}`;
    const body = qty
      ? `Qty: ${fmt(qty, 6)} · Avg: $${fmt(avg)} · PnL: $${fmt(pnl)}`
      : debug
      ? "Test manual cron-eth-30m ✅"
      : "Actualización cada 30 min ✅";

    const payload = JSON.stringify({
      title,
      body,
      url: "/",
      tag: "eth-30m",
      renotify: false,
    });

    if (!subs.length) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          note: "no-subs",
          source,
          price,
          position,
        }),
      };
    }

    const res = await sendAll(subs, payload);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        price,
        position,
        subs: subs.length,
        source,
        ...res,
      }),
    };
  } catch (e: any) {
    console.error("cron-eth-30m fatal:", e?.message || e);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};

// ⏰ cada 30 min (UTC)
export const config = { schedule: "*/30 * * * *" };
