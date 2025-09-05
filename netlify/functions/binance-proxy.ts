import type { Handler } from "@netlify/functions";

// Mapas de intervalos
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
const COINBASE_GRANULARITY: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "8h": 28800,
  "12h": 43200,
  "1d": 86400,
  // (Coinbase no tiene 3d/1w/1M directamente; podrías agregarlos agregando agregación)
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const qs = event.queryStringParameters ?? {};
    const symbol = String(qs.symbol || "ETHUSDT").toUpperCase(); // Binance-style
    const interval = String(qs.interval || "5m");
    const limit = Math.min(Math.max(Number(qs.limit || 36), 1), 1000);

    if (!ALLOWED_INTERVALS.has(interval)) {
      return { statusCode: 400, body: "Invalid interval" };
    }

    // 1) Intentar Binance
    const binanceURL = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const bRes = await fetch(binanceURL, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "user-agent": "orders-tracker/1.0 binance-proxy",
      },
    });

    const maybeRestricted = async () => {
      // Binance manda 200 con body {code:0,msg:...} o un 4xx/5xx
      const txt = await bRes.text();
      try {
        const j = JSON.parse(txt);
        if (j && typeof j === "object" && "code" in j && j.code === 0)
          return { restricted: true };
      } catch {
        /* no-JSON klines esperado */
      }
      // Si era klines válido, devolvelo directo
      return { restricted: false, body: txt, ok: bRes.ok };
    };

    if (bRes.ok) {
      const res = await maybeRestricted();
      if (!res.restricted) {
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, s-maxage=30, max-age=0",
          },
          body: res.body!,
        };
      }
    }

    // 2) Fallback a Coinbase si Binance está restringido/caído
    //    Usamos ETH-USD y convertimos al formato "klines" de Binance:
    //    [openTime, open, high, low, close, volume, closeTime, qav, trades, ...]
    const product = "ETH-USD";
    const gran = COINBASE_GRANULARITY[interval];
    if (!gran) {
      return { statusCode: 400, body: "Interval not supported on fallback" };
    }

    const cbURL = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}`;
    const cRes = await fetch(cbURL, {
      headers: {
        accept: "application/json",
        "user-agent": "orders-tracker/1.0 coinbase-fallback",
      },
    });
    if (!cRes.ok) {
      const text = await cRes.text().catch(() => "");
      return { statusCode: 502, body: text || "Fallback provider error" };
    }
    // Coinbase devuelve: [ time, low, high, open, close, volume ] en orden DESC.
    const arr: [number, number, number, number, number, number][] =
      await cRes.json();
    const asc = arr.slice(0, limit).reverse();

    // Convertir al formato de Binance klines (mínimo necesario para tu app)
    const klines = asc.map((c) => {
      const [time, low, high, open, close, volume] = c;
      const openTime = time * 1000;
      const closeTime = openTime + gran * 1000 - 1;
      return [
        openTime, // 0: Open time (ms)
        String(open), // 1: Open
        String(high), // 2: High
        String(low), // 3: Low
        String(close), // 4: Close
        String(volume), // 5: Volume
        closeTime, // 6: Close time
        "0", // 7: Quote asset volume (dummy)
        0, // 8: Number of trades (dummy)
        "0",
        "0",
        "0",
        "0", // 9..12 dummies para match del array
      ];
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=30, max-age=0",
      },
      body: JSON.stringify(klines),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `proxy error: ${e?.message || e}` };
  }
};
