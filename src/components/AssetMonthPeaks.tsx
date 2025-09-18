import { useEffect, useMemo, useState } from "react";

type OrderType = "BUY" | "SELL";

type Candle = {
  t: number; // open time (ms)
  open: number;
  high: number;
  low: number;
  close: number;
};

type Peak = {
  t: number;
  price: number;
  idx: number;
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function toSymbol(asset: string) {
  return `${asset.toUpperCase()}USDT`;
}

async function fetchMonth1h(symbol: string, limit = 720): Promise<Candle[]> {
  const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=1h&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`proxy ${r.status}`);
  const raw = (await r.json()) as any[];
  return raw.map((k) => ({
    t: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));
}

function detectLocalExtrema(
  data: number[],
  w: number,
  type: "min" | "max"
): number[] {
  const idxs: number[] = [];
  for (let i = w; i < data.length - w; i++) {
    const cur = data[i];
    let isExt = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (type === "min" && data[j] <= cur) {
        isExt = false;
        break;
      }
      if (type === "max" && data[j] >= cur) {
        isExt = false;
        break;
      }
    }
    if (isExt) idxs.push(i);
  }
  return idxs;
}

function dedupeByTime(peaks: Peak[], candles: Candle[], minHours = 6) {
  const keep: Peak[] = [];
  const minMs = minHours * 3600 * 1000;
  for (const p of peaks) {
    const tooClose = keep.some(
      (k) => Math.abs(candles[p.idx].t - candles[k.idx].t) < minMs
    );
    if (!tooClose) keep.push(p);
  }
  return keep;
}

function hourUTCminus3(ms: number) {
  const utcHour = new Date(ms).getUTCHours();
  return (utcHour - 3 + 24) % 24;
}

function ddmmyy_hhmm_utc3(ms: number) {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(hourUTCminus3(ms)).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${String(yyyy).slice(-2)} ${hh}:${min}`;
}

function Sparkline({ candles, peaks }: { candles: Candle[]; peaks: Peak[] }) {
  if (!candles.length) return null;
  const w = 600;
  const h = 120;
  const pad = 8;

  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;

  const X = (i: number) =>
    pad + (i * (w - 2 * pad)) / Math.max(1, candles.length - 1);
  const Y = (price: number) => pad + (h - 2 * pad) * (1 - (price - min) / span);

  let d = "";
  closes.forEach((v, i) => {
    const x = X(i);
    const y = Y(v);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[140px]">
      <rect x="0" y="0" width={w} height={h} className="fill-neutral-900/50" />
      <path d={d} className="stroke-white/80 fill-none" strokeWidth={1.5} />
      <line
        x1={pad}
        x2={w - pad}
        y1={Y(min)}
        y2={Y(min)}
        className="stroke-emerald-500/30"
        strokeWidth={1}
      />
      <line
        x1={pad}
        x2={w - pad}
        y1={Y(max)}
        y2={Y(max)}
        className="stroke-rose-500/30"
        strokeWidth={1}
      />
      {peaks.map((p, i) => (
        <circle
          key={i}
          cx={X(p.idx)}
          cy={Y(p.price)}
          r={3.5}
          className="fill-sky-400 stroke-neutral-900"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

export default function AssetMonthPeaks({
  asset = "ETH",
  orderType = "SELL",
}: {
  asset?: string;
  orderType?: OrderType;
}) {
  const symbol = useMemo(() => toSymbol(asset || "ETH"), [asset]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);

  async function run() {
    try {
      setLoading(true);
      setErr(null);
      const data = await fetchMonth1h(symbol, 720);
      setCandles(data);

      const closes = data.map((c) => c.close);
      const type = orderType === "BUY" ? "max" : "min";
      const idxs = detectLocalExtrema(closes, 4, type);

      let ext: Peak[] = idxs.map((i) => ({
        t: data[i].t,
        price: closes[i],
        idx: i,
      }));

      ext.sort((a, b) =>
        orderType === "BUY" ? b.price - a.price : a.price - b.price
      );

      ext = dedupeByTime(ext, data, 6).slice(0, 10);

      setPeaks(ext);
      setLastAt(Date.now());
    } catch (e: any) {
      setErr(e?.message || "Error de red/APIs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, orderType]);

  // Frase resumen automática
  const summary = useMemo(() => {
    if (!candles?.length) return "";
    const closes = candles.map((c) => c.close);
    const last = closes.at(-1) || 0;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const pos = (last - min) / span;

    if (orderType === "SELL") {
      if (pos <= 0.3)
        return "El precio está más cerca de los mínimos: vender ahora es menos favorable.";
      if (pos >= 0.7)
        return "El precio está en zona alta: puede ser buen momento para vender.";
      return "El precio está en zona intermedia: sin señal clara de venta.";
    } else {
      if (pos <= 0.3)
        return "El precio está bajo: puede ser buen momento para comprar.";
      if (pos >= 0.7)
        return "El precio está caro: comprar ahora es más riesgoso.";
      return "El precio está en zona intermedia: sin señal clara de compra.";
    }
  }, [candles, orderType]);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          {asset.toUpperCase()} — Último mes (1h)
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-neutral-400">
          {lastAt && (
            <span>Actualizado: {new Date(lastAt).toLocaleTimeString()}</span>
          )}
          {loading && <span>· Actualizando…</span>}
        </div>
      </div>

      {err && <div className="text-sm text-rose-400">Error: {String(err)}</div>}
      {!candles && !err && (
        <div className="text-sm text-neutral-400">Cargando…</div>
      )}

      {!!candles && (
        <>
          <Sparkline candles={candles} peaks={peaks} />

          <div className="flex items-center justify-between mt-1">
            <div className="text-sm text-neutral-300">
              {orderType === "BUY"
                ? "Top 10 picos más altos (UTC-3)"
                : "Top 10 picos más bajos (UTC-3)"}
            </div>
            <button
              onClick={run}
              disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                loading
                  ? "opacity-50 cursor-not-allowed bg-white/10"
                  : "bg-white/10 hover:bg-white/20"
              }`}
            >
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          <div className="rounded-xl border border-neutral-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900/70">
                <tr>
                  <th className="px-3 py-2 text-left w-24">#</th>
                  <th className="px-3 py-2 text-left">Fecha (UTC-3)</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                </tr>
              </thead>
              <tbody className="[&_tr:nth-child(even)]:bg-neutral-900/20">
                {peaks.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-neutral-400">
                      No se detectaron picos claros el último mes.
                    </td>
                  </tr>
                ) : (
                  peaks.map((p, i) => (
                    <tr
                      key={`${p.idx}-${i}`}
                      className="border-t border-neutral-900/50"
                    >
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {ddmmyy_hhmm_utc3(candles![p.idx].t)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtMoney(p.price)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-neutral-500">
            *Los picos se detectan con una ventana ±4h y se desduplican a ≥6h.
            Úsalo como guía horaria; no es garantía de repetición.
          </div>

          {/* Frase resumen */}
          <div className="mt-2 text-sm font-medium text-neutral-300">
            📌 {summary}
          </div>
        </>
      )}
    </section>
  );
}
