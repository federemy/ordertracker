// netlify/functions/cron-eth-30m.ts
import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getStore } from "@netlify/blobs";

// ====== Tipos ======
type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };
type Order = {
  side: "buy" | "sell";
  qty: number; // cantidad de ETH
  price: number; // precio en USD por ETH
  ts?: number; // timestamp opcional
  feeUsd?: number; // opcional
};
type PositionFallback = { qty: number; avgPrice: number };

// ====== ENV / VAPID ======
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";
const SYMBOL = process.env.BINANCE_SYMBOL || "ETHUSDT"; // opcional, por defecto ETH/USDT

function assertEnv() {
  const missing: string[] = [];
  if (!VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
  if (!VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
  if (missing.length) throw new Error("Faltan env vars: " + missing.join(", "));
}

webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ====== Utils ======
const fmt = (n: number, d = 2) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

async function fetchEthPrice(): Promise<number> {
  // Binance ticker (precio en USDT)
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${SYMBOL}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`binance ${res.status} ${res.statusText}`);
  const j = (await res.json()) as { symbol: string; price: string };
  const p = Number(j.price);
  if (!Number.isFinite(p)) throw new Error("Precio inválido desde Binance");
  return p;
}

async function loadSubs(): Promise<Sub[]> {
  const store = getStore("subs");
  const { blobs } = await store.list();
  const out: Sub[] = [];
  for (const b of blobs) {
    const sub = await store.get(b.key, { type: "json" });
    if (sub?.endpoint) out.push(sub as Sub);
  }
  return out;
}

async function sendAll(payload: string) {
  const store = getStore("subs");
  const { blobs } = await store.list();
  let sent = 0,
    failed = 0;
  const toDelete: string[] = [];

  await Promise.allSettled(
    blobs.map(async (b) => {
      try {
        const sub = await store.get(b.key, { type: "json" });
        await webpush.sendNotification(sub as any, payload);
        sent++;
      } catch (e: any) {
        failed++;
        const code = e?.statusCode;
        if (code === 404 || code === 410) toDelete.push(b.key);
        console.error("push error", code, e?.body || e?.message);
      }
    })
  );

  for (const k of toDelete) await store.delete(k);
  return { sent, failed, total: blobs.length };
}

// ====== Posición (desde órdenes o fallback) ======
async function loadPosition(): Promise<{
  qty: number;
  avgPrice: number;
} | null> {
  // 1) Intentar desde órdenes
  const ordersStore = getStore("orders");
  const orders = (await ordersStore.get("list", { type: "json" })) as
    | Order[]
    | null;

  if (orders && Array.isArray(orders) && orders.length) {
    // modelo simple: promedio móvil (reduce costo al vender con precio promedio actual)
    let qty = 0;
    let cost = 0; // costo total en USD de la posición abierta
    for (const o of orders) {
      const fee = Number(o.feeUsd || 0);
      if (o.side === "buy") {
        qty += o.qty;
        cost += o.qty * o.price + fee;
      } else if (o.side === "sell") {
        const avg = qty > 0 ? cost / qty : 0;
        qty -= o.qty;
        cost -= avg * o.qty; // realizamos costo proporcional (PNL realizado lo ignoramos aquí)
        if (qty < 1e-12) {
          qty = 0;
          cost = 0;
        }
      }
    }
    if (qty > 0) {
      const avgPrice = cost / qty;
      return { qty, avgPrice };
    }
  }

  // 2) Fallback: posición guardada explícita
  const pfStore = getStore("portfolio");
  const pos = (await pfStore.get("eth", {
    type: "json",
  })) as PositionFallback | null;
  if (pos && Number.isFinite(pos.qty) && Number.isFinite(pos.avgPrice)) {
    return { qty: pos.qty, avgPrice: pos.avgPrice };
  }

  return null;
}

// ====== Handler ======
export const handler: Handler = async (event) => {
  try {
    assertEnv();
    const debug = event.queryStringParameters?.debug === "1";

    // precio actual
    const price = await fetchEthPrice();

    // posición del usuario
    const position = await loadPosition();
    let qty = 0,
      avg = 0,
      pnl = 0;

    if (position) {
      qty = position.qty;
      avg = position.avgPrice;
      pnl = (price - avg) * qty;
    }

    // título y cuerpo
    const title = position
      ? `ETH $${fmt(price)} | Δ $${fmt(pnl)}`
      : `ETH $${fmt(price)}`;

    const body = position
      ? `Qty: ${fmt(qty, 6)} · Avg: $${fmt(avg)} · PnL: $${fmt(pnl)}`
      : debug
      ? "Test manual cron-eth-30m ✅"
      : "Actualización cada 30 min ✅";

    const payload = JSON.stringify({
      title,
      body,
      url: "/", // abrí tu app si querés otra ruta
      tag: "eth-30m",
      renotify: false,
    });

    // si no hay suscriptores, respondemos ok para no fallar el cron
    const subs = await loadSubs();
    if (!subs.length) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          note: "no-subs",
          price,
          position: position ?? null,
        }),
      };
    }

    const res = await sendAll(payload);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        price,
        position: position ?? null,
        ...res,
      }),
    };
  } catch (e: any) {
    console.error("cron-eth-30m fatal:", e?.message || e);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};

// ⏰ cada 30 minutos (UTC)
export const config = { schedule: "*/30 * * * *" };
