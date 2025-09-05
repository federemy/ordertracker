// netlify/functions/binance-proxy.ts
import type { Handler } from "@netlify/functions";

const ALLOWED_INTERVALS = new Set([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
]);

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const qs = event.queryStringParameters || {};
    const symbol = (qs.symbol || "ETHUSDT").toUpperCase();
    const interval = String(qs.interval || "5m");
    const limit = Math.min(Math.max(Number(qs.limit || 36), 1), 1000); // 1..1000

    if (!ALLOWED_INTERVALS.has(interval)) {
      return { statusCode: 400, body: "Invalid interval" };
    }
    if (!/^[A-Z0-9]{5,15}$/.test(symbol)) {
      return { statusCode: 400, body: "Invalid symbol" };
    }

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const resp = await fetch(url, {
      headers: {
        "cache-control": "no-cache",
        "user-agent":
          "orders-tracker/1.0 (+https://your-site.example) binance-proxy",
        accept: "application/json",
      },
    });

    // Propaga código de error si Binance falló
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { statusCode: resp.status, body: text || "Upstream error" };
    }

    const data = await resp.json();

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        // Micro-cache CDN (ajusta o quita si no querés cachear)
        "cache-control": "public, s-maxage=30, max-age=0",
      },
      body: JSON.stringify(data),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `binance-proxy error: ${e?.message || e}` };
  }
};
