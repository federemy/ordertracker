import { useEffect, useMemo, useState } from "react";

type Candle = { t: number; close: number };

async function fetchETH1h(limit = 24): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(String(r.status));
  const raw: any[] = await r.json();
  return raw.map((k) => ({
    t: k[0],
    close: Number(k[4]),
  }));
}

function sma(arr: number[], n: number) {
  if (arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function sparkPath(values: number[], w = 240, h = 56, padX = 6, padY = 6) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  return values
    .map((v, i) => {
      const x = padX + (i * innerW) / (values.length - 1 || 1);
      const y = padY + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function EthTrend() {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const data = await fetchETH1h(24);
        setCandles(data);
      } catch (e: any) {
        setErr(e?.message || "Error al cargar datos");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const last = closes.at(-1) || 0;
  const first = closes[0] || 0;

  const pct24h = first ? ((last - first) / first) * 100 : 0;
  const max24 = closes.length ? Math.max(...closes) : 0;
  const min24 = closes.length ? Math.min(...closes) : 0;

  const sma6 = sma(closes, 6);
  const sma24 = sma(closes, 24);

  const bias = useMemo(() => {
    if (!sma6 || !sma24) return "Indefinido";
    const gap = (sma6 - sma24) / sma24;
    if (gap > 0.004) return "Alcista (SMA6 > SMA24)";
    if (gap < -0.004) return "Bajista (SMA6 < SMA24)";
    return "Lateral (SMA6 ≈ SMA24)";
  }, [sma6, sma24]);

  const color =
    pct24h > 0
      ? "text-emerald-400"
      : pct24h < 0
      ? "text-rose-400"
      : "text-neutral-300";

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          Tendencia de Ethereum (24 h)
        </div>
        <div className="text-sm text-neutral-400">
          Fuente: Binance — velas 1 h
        </div>
      </div>

      {loading ? (
        <div className="text-neutral-400 text-sm">Cargando ETH/USDT…</div>
      ) : err ? (
        <div className="text-rose-400 text-sm">Error: {err}</div>
      ) : (
        <>
          {/* Sparkline */}
          <div className="rounded-xl bg-neutral-950/50 border border-neutral-800 p-3">
            <svg
              width="100%"
              height="64"
              viewBox="0 0 260 64"
              preserveAspectRatio="none"
            >
              <path
                d={sparkPath(closes, 260, 64)}
                fill="none"
                stroke={pct24h >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            </svg>
          </div>

          {/* Métricas + Explicación */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400">Precio actual</div>
              <div className="text-xl font-semibold tabular-nums">
                ${last.toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400">% 24 h</div>
              <div className={`text-xl font-semibold tabular-nums ${color}`}>
                {pct24h >= 0 ? "+" : ""}
                {pct24h.toFixed(2)}%
              </div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400">Rango 24 h</div>
              <div className="tabular-nums">
                <span className="text-neutral-300">${min24.toFixed(2)}</span>
                <span className="text-neutral-500 mx-1">→</span>
                <span className="text-neutral-300">${max24.toFixed(2)}</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400">Sesgo</div>
              <div className="font-semibold">{bias}</div>
              <div className="text-xs text-neutral-400 mt-1">
                Heurística: comparamos <b>SMA(6)</b> vs <b>SMA(24)</b>.
              </div>
            </div>
          </div>

          <div className="text-sm text-neutral-300 leading-relaxed">
            <b>Cómo leerlo:</b> si el precio actual (línea) se sostiene por
            encima de la media corta (SMA6) y ésta a su vez está sobre la media
            larga (SMA24), hablamos de <b>tendencia alcista</b>. Si ocurre lo
            contrario, es <b>bajista</b>. Cuando ambas medias están muy cerca,
            consideramos un sesgo <b>lateral</b>. El % 24 h te da el movimiento
            diario, y el rango muestra máximos/mínimos recientes para
            dimensionar volatilidad.
          </div>
        </>
      )}
    </section>
  );
}
