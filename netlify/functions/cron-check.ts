import { Handler } from "@netlify/functions";
import webPush from "web-push";
import { getStore } from "@netlify/blobs";

type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

const ORDERS_BUCKET = "orders";
const ORDERS_KEY = "orders.json";

const SUBS_BUCKET = "subs";
const SUBS_KEY = "subs.json";

const STATE_BUCKET = "state";
const SIGNS_KEY = "signs.json";

/** Fee spot (VIP0) – usá el mismo valor que en la web */
const FEE_RATE_SPOT = 0.0015; // 0.15%

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = "mailto:you@example.com"; // opcional

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("VAPID keys missing in environment variables");
}
webPush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const binancePrice = async (asset: string): Promise<number | null> => {
  const symbol = `${asset.toUpperCase()}USDT`;
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { headers: { "cache-control": "no-cache" } }
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const p = Number(j?.price);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
};

/** Δ neto si cierro ahora (solo fee de la operación de cierre) */
function deltaNetCloseNow(o: Order, current: number): number {
  const side = o.side ?? "SELL";
  const totalUsd = o.qty * o.price;

  if (current <= 0 || o.qty <= 0 || o.price <= 0) return 0;

  if (side === "SELL") {
    // Recomprar ahora (fee de COMPRA en la base)
    const baseRebuyGross = totalUsd / current; // ETH que podrías recomprar
    const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT; // fee cobrada en ETH
    const baseRebuyNet = baseRebuyGross - feeBuyBase; // ETH netos tras recomprar
    const deltaBase = baseRebuyNet - o.qty; // ETH netos ganados/perdidos
    return deltaBase * current; // valuado en USD
  } else {
    // Vender ahora (fee de VENTA sobre el USDT recibido)
    const proceedsAfterSell = o.qty * current * (1 - FEE_RATE_SPOT);
    const cost = totalUsd; // costo histórico (sin sumar fee de compra pasada)
    return proceedsAfterSell - cost;
  }
}

async function loadJSON<T>(
  bucket: string,
  key: string,
  fallback: T
): Promise<T> {
  const store = getStore(bucket);
  const data = await store.get(key, { type: "json" });
  return (data ?? fallback) as T;
}

async function saveJSON(bucket: string, key: string, data: any) {
  const store = getStore(bucket);
  await store.set(key, JSON.stringify(data), {
    contentType: "application/json",
  });
}

export const handler: Handler = async () => {
  try {
    // 1) Órdenes
    const orders: Order[] = await loadJSON(ORDERS_BUCKET, ORDERS_KEY, []);
    if (!Array.isArray(orders) || orders.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, note: "No orders" }),
      };
    }

    // 2) Precios
    const assets = Array.from(
      new Set(orders.map((o) => (o.asset || "").toUpperCase()).filter(Boolean))
    );
    const prices: Record<string, number> = {};
    await Promise.all(
      assets.map(async (a) => {
        const p = await binancePrice(a);
        if (p != null) prices[a] = p;
      })
    );
    if (Object.keys(prices).length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, note: "No prices" }),
      };
    }

    // 3) Subs
    const subs: any[] = await loadJSON(SUBS_BUCKET, SUBS_KEY, []);
    if (!Array.isArray(subs) || subs.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, note: "No subscribers" }),
      };
    }

    // 4) Estado previo de signos (por orden)
    type Signs = Record<string, number>;
    const prevSigns: Signs = await loadJSON(STATE_BUCKET, SIGNS_KEY, {});
    const nextSigns: Signs = { ...prevSigns };

    // 5) Enviar push a todos; limpiar inválidos (410/404)
    const stillValidSubs: any[] = [];
    const sendToAll = async (payload: any) => {
      const bodyStr = JSON.stringify(payload);
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webPush.sendNotification(s, bodyStr);
            stillValidSubs.push(s);
          } catch (e: any) {
            const code = e?.statusCode;
            // 404/410 = endpoint inválido -> no lo guardamos
            if (code !== 404 && code !== 410) {
              stillValidSubs.push(s);
            }
          }
        })
      );
    };

    // 6) Evaluar cruces NETOS
    let pushes = 0;
    for (const o of orders) {
      const curr = prices[(o.asset || "").toUpperCase()] || 0;
      if (!curr) continue;

      const net = deltaNetCloseNow(o, curr);
      const sign = net > 0 ? 1 : net < 0 ? -1 : 0;
      const prev = prevSigns[o.id] ?? 0;

      // cruce neto a ganancia
      if (prev <= 0 && sign > 0) {
        const title = `✅ Ganancia neta en ${o.asset}`;
        const body = `${net >= 0 ? "+" : ""}${net.toFixed(2)} USD · ${
          o.side ?? "SELL"
        } ${o.qty} @ ${o.price} → ${curr.toFixed(2)}`;
        await sendToAll({ title, body });
        pushes++;
      }

      nextSigns[o.id] = sign;
    }

    // 7) Guardar estado y subs
    await Promise.all([
      saveJSON(STATE_BUCKET, SIGNS_KEY, nextSigns),
      saveJSON(
        SUBS_BUCKET,
        SUBS_KEY,
        stillValidSubs.length ? stillValidSubs : subs
      ),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, assets, pushes }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "cron-check error" };
  }
};
