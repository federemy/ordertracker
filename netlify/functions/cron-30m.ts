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
type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

const FEE = 0.0015; // 0.15% spot
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = "mailto:you@example.com";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
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

// Precio break-even (neto 0) usando el mismo criterio de tu UI:
const breakEven = (o: Order) =>
  (o.side ?? "SELL") === "SELL" ? o.price * (1 - FEE) : o.price / (1 - FEE);

// % diferencia vs break-even: (current - be) / be * 100
const pctVsBE = (current: number, be: number) =>
  be > 0 ? ((current - be) / be) * 100 : 0;

export const handler: Handler = async () => {
  try {
    // 1) Datos base
    const orders = (await getList<Order[]>("orders", "list")) || [];
    const subs = (await getList<Sub[]>("subs", "list")) || [];
    if (!orders.length || !subs.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, note: "no orders or no subs" }),
      };
    }

    // 2) Precios actuales
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

    // 3) Construir mensaje (una línea por orden)
    const lines: string[] = [];
    for (const o of orders) {
      const a = (o.asset || "").toUpperCase();
      const current = prices[a];
      if (!current) continue;
      const be = breakEven(o);
      const pct = pctVsBE(current, be);
      const sgn = pct >= 0 ? "+" : "";
      lines.push(
        `${a} ${sgn}${pct.toFixed(2)}% vs BE  · ${current.toFixed(
          2
        )} / BE ${be.toFixed(2)}`
      );
    }
    if (!lines.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, note: "no price lines" }),
      };
    }

    // 4) Evitar spam opcional (solo si cambió algo desde la última vez)
    const lastHash = (await getList<string>("state", "lastHash")) || "";
    const payloadBody = lines.slice(0, 6).join("\n"); // limita tamaño
    const newHash = String(payloadBody);
    const same = newHash === lastHash;

    // 5) Push
    const message = JSON.stringify({
      title: "⏱️ Actualización 30m",
      body: payloadBody,
      url: "/",
    });

    let sent = 0;
    if (!same) {
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webPush.sendNotification(s as any, message);
            sent++;
          } catch {}
        })
      );
      await setList("state", "lastHash", newHash);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        assets,
        sent,
        lines: lines.length,
        skippedSame: same,
      }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `cron-30m error: ${e?.message || e}` };
  }
};
