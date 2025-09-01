// netlify/functions/cron-check.ts
import type { Handler } from "@netlify/functions";
import webPush from "web-push";
import { getList, setList } from "./_store";

type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

const STORE_ORDERS = "orders";
const KEY_ORDERS = "list";

const STORE_SUBS = "subs";
const KEY_SUBS = "list";

const STORE_STATE = "state";
const KEY_SIGNS = "signs";

/** Fee spot (VIP0) – usá el mismo valor que en la web */
const FEE_RATE_SPOT = 0.0015; // 0.15%

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = "mailto:you@example.com"; // opcional

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("VAPID keys missing in environment variables");
} else {
  webPush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

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

export const handler: Handler = async () => {
  try {
    // 1) Órdenes (mismo bucket/key que save-orders)
    const orders: Order[] =
      (await getList<Order[]>(STORE_ORDERS, KEY_ORDERS)) || [];
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

    // 3) Subs (mismo bucket/key que save-subscription)
    const subs: any[] = (await getList<any[]>(STORE_SUBS, KEY_SUBS)) || [];
    if (!Array.isArray(subs) || subs.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, note: "No subscribers" }),
      };
    }

    // 4) Estado previo de signos (por orden)
    type Signs = Record<string, number>;
    const prevSigns: Signs =
      (await getList<Signs>(STORE_STATE, KEY_SIGNS)) || {};
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
        await sendToAll({ title, body, url: "/" });
        pushes++;
      }

      nextSigns[o.id] = sign;
    }

    // 7) Guardar estado y (si corresponde) subs filtradas
    await Promise.all([
      setList(STORE_STATE, KEY_SIGNS, nextSigns),
      setList(
        STORE_SUBS,
        KEY_SUBS,
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
