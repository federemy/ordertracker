import { useEffect, useMemo, useState } from "react";
import { SMA, RSI, MACD } from "technicalindicators";

/* Helpers locales */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const cn = (...a: (string | false | null | undefined)[]) =>
  a.filter(Boolean).join(" ");

type Candle = { close: number; high: number; low: number; volume: number };

function klinesToCandles(klines: any[]): Candle[] {
  // kline: [openTime, open, high, low, close, volume, closeTime, ...]
  return klines.map((k) => ({
    close: Number(k[4]),
    high: Number(k[2]),
    low: Number(k[3]),
    volume: Number(k[5]),
  }));
}

export function MarketBiasAnalyzerBinance({
  asset, // "ETH", "BTC", etc.
  interval = "1h", // "15m" | "1h" | "4h" | "1d"
  limit = 300,
  refreshMs = 60000, // 60s
}: {
  asset: string;
  interval?: "15m" | "1h" | "4h" | "1d";
  limit?: number;
  refreshMs?: number;
}) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pair = `${asset?.toUpperCase()}USDT`;

  const fetchKlines = async () => {
    try {
      setLoading(true);
      setErr(null);
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCandles(klinesToCandles(data));
    } catch (e: any) {
      console.error(e);
      setErr("No pude traer velas de Binance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKlines();
    const id = setInterval(fetchKlines, refreshMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, interval, limit]);

  const diagnosis = useMemo(() => {
    if (!candles || candles.length < 210) return null;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    const sma20 = SMA.calculate({ period: 20, values: closes });
    const sma50 = SMA.calculate({ period: 50, values: closes });
    const sma200 = SMA.calculate({ period: 200, values: closes });
    const rsi = RSI.calculate({ values: closes, period: 14 });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const lastClose = closes[closes.length - 1];
    const lastSMA20 = sma20[sma20.length - 1];
    const lastSMA50 = sma50[sma50.length - 1];
    const lastSMA200 = sma200[sma200.length - 1];
    const lastRSI = rsi[rsi.length - 1];
    const lastMACD = macd.length ? macd[macd.length - 1] : undefined;

    const avgVol20 =
      volumes.slice(-20).reduce((a, b) => a + b, 0) /
      Math.max(1, Math.min(20, volumes.length));
    const lastVol = volumes[volumes.length - 1];

    let signals: string[] = [];

    // Estructura HH/HL vs LH/LL con últimas 5 velas
    if (highs.length >= 5 && lows.length >= 5) {
      const H = highs.slice(-5);
      const L = lows.slice(-5);
      if (H[4] > H[2] && L[4] > L[2]) {
        signals.push("Estructura: máximos y mínimos crecientes (alcista)");
      } else if (H[4] < H[2] && L[4] < L[2]) {
        signals.push("Estructura: máximos y mínimos decrecientes (bajista)");
      } else {
        signals.push("Estructura: lateral/mixta (indefinida)");
      }
    }

    // Medias móviles
    if (
      lastClose > lastSMA20 &&
      lastSMA20 > lastSMA50 &&
      lastSMA50 > lastSMA200
    ) {
      signals.push("MM: precio > SMA20>50>200 (sesgo alcista fuerte)");
    } else if (
      lastClose < lastSMA20 &&
      lastSMA20 < lastSMA50 &&
      lastSMA50 < lastSMA200
    ) {
      signals.push("MM: precio < SMA20<50<200 (sesgo bajista fuerte)");
    } else {
      signals.push("MM: mixtas (sin sesgo claro)");
    }

    // RSI
    if (lastRSI > 70)
      signals.push("RSI: >70 (sobrecompra, riesgo de corrección)");
    else if (lastRSI < 30)
      signals.push("RSI: <30 (sobreventa, posible rebote)");
    else signals.push("RSI: 30–70 (neutro)");

    // MACD
    if (
      lastMACD &&
      typeof lastMACD.MACD === "number" &&
      typeof lastMACD.signal === "number"
    ) {
      if (lastMACD.MACD > lastMACD.signal && lastMACD.MACD > 0) {
        signals.push("MACD: cruce alcista en zona positiva");
      } else if (lastMACD.MACD < lastMACD.signal && lastMACD.MACD < 0) {
        signals.push("MACD: cruce bajista en zona negativa");
      } else {
        signals.push("MACD: mixto/neutro");
      }
    } else {
      signals.push("MACD: sin datos suficientes");
    }

    // Volumen relativo
    if (lastVol > avgVol20 * 1.5) {
      signals.push("Volumen: muy alto en la última vela (confirma movimiento)");
    } else if (lastVol < avgVol20 * 0.7) {
      signals.push("Volumen: bajo (movimiento poco confiable)");
    } else {
      signals.push("Volumen: dentro de lo normal");
    }

    // Sesgo final
    const bullish = signals.filter((s) =>
      s.toLowerCase().includes("alcista")
    ).length;
    const bearish = signals.filter((s) =>
      s.toLowerCase().includes("bajista")
    ).length;

    let bias: "Alcista" | "Bajista" | "Neutro" = "Neutro";
    if (bullish > bearish) bias = "Alcista";
    if (bearish > bullish) bias = "Bajista";

    return { bias, signals, lastClose, lastRSI, lastVol, avgVol20 };
  }, [candles]);

  const colorForSignal = (txt: string) => {
    const s = txt.toLowerCase();
    if (s.includes("alcista")) return "text-emerald-400";
    if (s.includes("bajista")) return "text-rose-400";
    if (
      s.includes("lateral") ||
      s.includes("mixta") ||
      s.includes("neutro") ||
      s.includes("normal") ||
      s.includes("indefinida")
    ) {
      return "text-yellow-300";
    }
    return "text-neutral-300";
  };

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 grid gap-3">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold">
          Sesgo técnico ({asset}/USDT • {interval})
        </div>
        <div className="text-xs text-neutral-400">
          {loading ? "Actualizando..." : "Listo"}
          {err ? <span className="text-rose-400 ml-2">{err}</span> : null}
        </div>
      </div>

      {!diagnosis ? (
        <div className="text-sm text-neutral-500">
          {err ? "Error al cargar datos" : "Cargando/insuficiente histórico…"}
        </div>
      ) : (
        <>
          <div className="text-base">
            Sesgo actual:{" "}
            <span
              className={cn(
                "font-semibold",
                diagnosis.bias === "Alcista"
                  ? "text-emerald-400"
                  : diagnosis.bias === "Bajista"
                  ? "text-rose-400"
                  : "text-yellow-300"
              )}
            >
              {diagnosis.bias}
            </span>{" "}
            <span className="text-neutral-400">
              | Cierre: {money.format(diagnosis.lastClose)} · RSI:{" "}
              {diagnosis.lastRSI?.toFixed(1)} · Vol/Avg20:{" "}
              {(diagnosis.lastVol / Math.max(1, diagnosis.avgVol20)).toFixed(2)}
              x
            </span>
          </div>
          <ul className="space-y-1 text-sm list-disc pl-5">
            {diagnosis.signals.map((s, i) => (
              <li key={i} className={colorForSignal(s)}>
                {s}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
export default MarketBiasAnalyzerBinance;
