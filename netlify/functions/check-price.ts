import type { Handler } from "@netlify/functions";
import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("[check-price] Missing VAPID keys");
}

type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

const SUBS_KEY = "subs.json"; // lo llena save-subscription
const ORDERS_KEY = "orders.json";
const PREV_SIGNS_KEY = "prev-signs.json";
const FEE = 0.0015; // 0.15% solo en el cierre

const BINANCE = (sym: string) =>
  `https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`;

function diffBruto(o: Order, current: number) {
  const side = o.side ?? "SELL";
  return side === "SELL"
    ? (o.price - current) * o.qty
    : (current - o.price) * o.qty;
}
function feeCierreUSD(o: Order, current: number) {
  return o.qty * current * FEE; // tu modelo “solo fee de cierre”
}

export const handler: Handler = async (_evt, ctx) => {
  // Blobs
  // @ts-ignore
  const blob = ctx?.blob || (globalThis as any).netlify?.blobs;

  // Cargar subs/acuerdos/prev_signs
  const subsR = await blob.get(SUBS_KEY);
  const subs: any[] = subsR ? JSON.parse(await subsR.text()) : [];
  if (!subs.length) return { statusCode: 200, body: "no subs" };

  const ordersR = await blob.get(ORDERS_KEY);
  const orders: Order[] = ordersR ? JSON.parse(await ordersR.text()) : [];
  if (!orders.length) return { statusCode: 200, body: "no orders" };

  const prevR = await blob.get(PREV_SIGNS_KEY);
  let prev: Record<string, number> = prevR
    ? JSON.parse(await prevR.text())
    : {};

  // Precios únicos
  const syms = [...new Set(orders.map((o) => o.asset.toUpperCase()))];
  const prices: Record<string, number> = {};
  for (const s of syms) {
    try {
      const r = await fetch(BINANCE(s));
      const j = await r.json();
      prices[s] = Number(j.price);
    } catch {}
  }

  // Configurar WebPush
  webpush.setVapidDetails(
    "mailto:you@example.com",
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string
  );

  // Evaluar cruces y notificar
  let pushes = 0;
  for (const o of orders) {
    const current = prices[o.asset.toUpperCase()] || 0;
    if (!current) continue;

    const bruto = diffBruto(o, current);
    const neto = bruto - feeCierreUSD(o, current);
    const newSign = neto > 0 ? 1 : neto < 0 ? -1 : 0;
    const oldSign = prev[o.id] ?? 0;

    if (oldSign <= 0 && newSign > 0) {
      const title = `Ganancia en ${o.asset}`;
      const body = `Neto: ${neto >= 0 ? "+" : ""}${neto.toFixed(
        2
      )} USD (precio ${current.toFixed(2)})`;
      for (const s of subs) {
        try {
          await webpush.sendNotification(s, JSON.stringify({ title, body }));
          pushes++;
        } catch {}
      }
    }
    prev[o.id] = newSign;
  }

  // Persistir prev_signs
  await blob.set(PREV_SIGNS_KEY, JSON.stringify(prev), {
    contentType: "application/json",
  });

  return { statusCode: 200, body: `ok pushes=${pushes}` };
};
