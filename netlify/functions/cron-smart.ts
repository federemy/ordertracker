import type { Handler } from "@netlify/functions";
import webPush from "web-push";
import { getList, setList } from "./_store";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
webPush.setVapidDetails(
  "mailto:you@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const STORE_SUBS = "subs";
const KEY_SUBS = "list";

const STORE_SETTINGS = "settings";
const KEY_SETTINGS = "byEndpoint";

const STORE_STATE = "smart-state";
const KEY_LAST = "lastSentByEndpoint";

const STORE_ORDERS = "orders";
const KEY_ORDERS = "list";
const FEE = 0.0015;

// === Helpers ===
type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

function deltaNetCloseNow(o: Order, current: number): number {
  const side = o.side ?? "SELL";
  const totalUsd = o.qty * o.price;
  if (current <= 0) return 0;

  if (side === "SELL") {
    const baseRebuyGross = totalUsd / current;
    const feeBuyBase = baseRebuyGross * FEE;
    const baseRebuyNet = baseRebuyGross - feeBuyBase;
    const deltaBase = baseRebuyNet - o.qty;
    return deltaBase * current;
  } else {
    const proceedsAfterSell = o.qty * current * (1 - FEE);
    return proceedsAfterSell - totalUsd;
  }
}

export const handler: Handler = async () => {
  try {
    // cargar subs
    const subs: any[] = (await getList<any[]>(STORE_SUBS, KEY_SUBS)) || [];
    if (!subs.length) return ok({ sent: 0, note: "no-subs" });

    // cargar prefs
    const prefs =
      (await getList<Record<string, { freqMinutes?: number }>>(
        STORE_SETTINGS,
        KEY_SETTINGS
      )) || {};
    const lastSent =
      (await getList<Record<string, number>>(STORE_STATE, KEY_LAST)) || {};

    // calcular neto actual de órdenes
    const orders: Order[] =
      (await getList<Order[]>(STORE_ORDERS, KEY_ORDERS)) || [];
    let totalNet = 0;
    if (orders.length) {
      const syms = [...new Set(orders.map((o) => o.asset.toUpperCase()))];
      const prices: Record<string, number> = {};
      for (const s of syms) {
        try {
          const r = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${s}USDT`
          );
          const j: any = await r.json();
          prices[s] = Number(j?.price);
        } catch {}
      }
      totalNet = orders.reduce((sum, o) => {
        const curr = prices[o.asset.toUpperCase()] || 0;
        return sum + deltaNetCloseNow(o, curr);
      }, 0);
    }

    const now = Date.now();
    let sent = 0;
    const still: any[] = [];

    for (const s of subs) {
      const endpoint = s?.endpoint;
      if (!endpoint) continue;

      // ⚡ regla: si neto > 0, frecuencia = 1 min
      const freqMin =
        totalNet > 0 ? 1 : Math.max(1, prefs[endpoint]?.freqMinutes ?? 30);
      const dueMs = freqMin * 60_000;
      const last = lastSent[endpoint] || 0;

      if (now - last >= dueMs) {
        try {
          const payload = JSON.stringify({
            title: totalNet > 0 ? "🟢 Neto positivo" : "🔔 Recordatorio",
            body:
              totalNet > 0
                ? `Ganancia neta: +${totalNet.toFixed(2)} USD`
                : `Actualizá tu análisis · intervalo: ${freqMin} min`,
            data: { url: "/" },
          });
          await webPush.sendNotification(s, payload);
          lastSent[endpoint] = now;
          sent++;
          still.push(s);
        } catch (e: any) {
          const code = e?.statusCode;
          if (code !== 404 && code !== 410) still.push(s);
        }
      } else {
        still.push(s);
      }
    }

    await Promise.all([
      setList(STORE_SUBS, KEY_SUBS, still),
      setList(STORE_STATE, KEY_LAST, lastSent),
    ]);

    return ok({ sent, subs: still.length, totalNet });
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "cron-smart error" };
  }
};

function ok(obj: any) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, ...obj }),
  };
}
