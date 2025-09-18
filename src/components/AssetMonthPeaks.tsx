import { useEffect, useMemo, useState } from "react";

type OrderType = "BUY" | "SELL";
type PeriodKey = "24h" | "7d" | "1m";

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

async function fetchCandles(
  symbol: string,
  period: PeriodKey
): Promise<Candle[]> {
  // Config por período (todo 1h para consistencia)
  const limit = period === "24h" ? 24 : period === "7d" ? 168 : /* 1m */ 720;
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

function dedupeByTime(peaks: Peak[], candles: Candle[], minHours: number) {
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

function utcMinus3Hour(ms: number) {
  const utcHour = new Date(ms).getUTCHours();
  return (utcHour - 3 + 24) % 24;
}

function ddmmyy_hhmm_utc3(ms: number) {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(utcMinus3Hour(ms)).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${String(yyyy).slice(-2)} ${hh}:${min}`;
}

function hoursHistogramUTC3(peaks: Peak[], candles: Candle[]) {
  // cuenta ocurrencias por hora (0..23) en UTC-3
  const map = new Map<number, number>();
  for (const p of peaks) {
    const h = utcMinus3Hour(candles[p.idx].t);
    map.set(h, (map.get(h) || 0) + 1);
  }
  // ordena desc por frecuencia
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([h, c]) => ({ hour: h, count: c }));
}

function topHoursLabel(hist: { hour: number; count: number }[], k = 3) {
  if (!hist.length) return "";
  const top = hist.slice(0, k).map((x) => x.hour);
  if (top.length === 1)
    return `alrededor de las ${String(top[0]).padStart(2, "0")}:00 (UTC-3)`;
  if (top.length === 2)
    return `alrededor de las ${String(top[0]).padStart(2, "0")}:00 y ${String(
      top[1]
    ).padStart(2, "0")}:00 (UTC-3)`;
  return `entre ${String(top[0]).padStart(2, "0")}:00, ${String(
    top[1]
  ).padStart(2, "0")}:00 y ${String(top[2]).padStart(2, "0")}:00 (UTC-3)`;
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
      {/* guía min / max */}
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

/** Traduce posición relativa (0..1) a etiqueta simple para BUY/SELL */
function zoneLabel(pos: number, orderType: OrderType) {
  // pos ~ 0 = cerca del mínimo, pos ~ 1 = cerca del máximo
  if (orderType === "SELL") {
    if (pos >= 0.7) return "zona alta (bueno para vender)";
    if (pos <= 0.3) return "zona baja (menos favorable para vender)";
    return "zona intermedia";
  } else {
    if (pos <= 0.3) return "zona baja (bueno para comprar)";
    if (pos >= 0.7) return "zona alta (más riesgoso comprar)";
    return "zona intermedia";
  }
}

function posScore(pos: number, orderType: OrderType) {
  // SELL desea pos alto → +1; BUY desea pos bajo → +1
  if (orderType === "SELL") return pos * 2 - 1; // 0..1 → -1..+1
  return (1 - pos) * 2 - 1; // BUY: pos bajo → +1
}

function periodTitle(p: PeriodKey) {
  return p === "24h" ? "24 h" : p === "7d" ? "7 días" : "1 mes";
}

export function AssetPeaksPeriod({
  asset = "ETH",
  orderType = "SELL",
  period = "1m",
  onSummary, // recibe: (period, score)
  onHours, // recibe: (period, topHours[])
}: {
  asset?: string;
  orderType?: OrderType;
  period?: PeriodKey;
  onSummary?: (p: PeriodKey, score: number) => void;
  onHours?: (p: PeriodKey, hours: number[]) => void;
}) {
  const symbol = useMemo(() => toSymbol(asset || "ETH"), [asset]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [topHours, setTopHours] = useState<number[]>([]);

  // Parámetros del detector por período
  const windowSize = period === "24h" ? 2 : period === "7d" ? 3 : 4;
  const minHours = period === "24h" ? 3 : 6;

  async function run() {
    try {
      setLoading(true);
      setErr(null);
      const data = await fetchCandles(symbol, period);
      setCandles(data);

      const closes = data.map((c) => c.close);
      const type = orderType === "BUY" ? "max" : "min";
      const idxs = detectLocalExtrema(closes, windowSize, type);

      let ext: Peak[] = idxs.map((i) => ({
        t: data[i].t,
        price: closes[i],
        idx: i,
      }));

      // Ordenamos por precio (SELL→mínimos, BUY→máximos) y desduplicamos temporalmente
      ext.sort((a, b) =>
        orderType === "BUY" ? b.price - a.price : a.price - b.price
      );
      ext = dedupeByTime(ext, data, minHours).slice(0, 10);

      setPeaks(ext);
      setLastAt(Date.now());

      // Resumen → pos y score
      const min = Math.min(...closes);
      const max = Math.max(...closes);
      const span = max - min || 1;
      const last = closes.at(-1) || 0;
      const pos = (last - min) / span;
      onSummary?.(period, posScore(pos, orderType));

      // Horas más frecuentes (UTC-3) de los picos
      const hist = hoursHistogramUTC3(ext, data);
      const top = hist.slice(0, 3).map((h) => h.hour);
      setTopHours(top);
      onHours?.(period, top);
    } catch (e: any) {
      setErr(e?.message || "Error de red/APIs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, orderType, period]);

  const summary = useMemo(() => {
    if (!candles?.length) return "";
    const closes = candles.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const last = closes.at(-1) || 0;
    const pos = (last - min) / span; // 0 piso, 1 techo

    const horas =
      topHours.length > 0
        ? `; picos probables ${topHoursLabel(
            topHours.map((h) => ({ hour: h, count: 1 }))
          )}`
        : "";

    return `Ahora está en ${zoneLabel(pos, orderType)}${horas}.`;
  }, [candles, orderType, topHours]);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          {asset.toUpperCase()} — {periodTitle(period)}
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
                      No se detectaron picos claros en este período.
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
            *Los picos se detectan con ventana ±{windowSize}h y se desduplican a
            ≥{minHours}h.
          </div>

          {/* Frase resumen */}
          <div className="mt-1 text-sm font-medium text-neutral-300">
            📌 {summary}
          </div>
        </>
      )}
    </section>
  );
}

/** Wrapper que muestra 24h, 7d y 1m y emite veredicto global + horas probables */
export default function AssetPeaksSuite({
  asset = "ETH",
  orderType = "SELL",
}: {
  asset?: string;
  orderType?: OrderType;
}) {
  const [scores, setScores] = useState<Record<PeriodKey, number>>({
    "24h": 0,
    "7d": 0,
    "1m": 0,
  });

  const [hoursByPeriod, setHoursByPeriod] = useState<
    Record<PeriodKey, number[]>
  >({
    "24h": [],
    "7d": [],
    "1m": [],
  });

  const onSummary = (p: PeriodKey, score: number) =>
    setScores((s) => ({ ...s, [p]: score }));

  const onHours = (p: PeriodKey, hours: number[]) =>
    setHoursByPeriod((h) => ({ ...h, [p]: hours }));

  const globalVerdict = useMemo(() => {
    // ponderación: intradía manda más
    const w24 = 0.5,
      w7 = 0.3,
      w1m = 0.2;
    const agg = scores["24h"] * w24 + scores["7d"] * w7 + scores["1m"] * w1m;
    if (orderType === "SELL") {
      if (agg > 0.25)
        return "En conjunto, el precio tiende a zona alta: es favorable para vender.";
      if (agg < -0.25)
        return "En conjunto, el precio tiende a zona baja: menos favorable para vender.";
      return "Las señales en conjunto no muestran una venta clara (zona intermedia).";
    } else {
      if (agg > 0.25)
        return "En conjunto, el precio no está barato: comprar ahora es más riesgoso.";
      if (agg < -0.25)
        return "En conjunto, el precio tiende a zona baja: puede ser favorable para comprar.";
      return "Las señales en conjunto no muestran una compra clara (zona intermedia).";
    }
  }, [scores, orderType]);

  const globalHours = useMemo(() => {
    // combinamos horas más probables ponderando por período
    const weight: Record<PeriodKey, number> = {
      "24h": 0.5,
      "7d": 0.3,
      "1m": 0.2,
    };
    const count = new Map<number, number>(); // hour -> score
    (Object.keys(hoursByPeriod) as PeriodKey[]).forEach((k) => {
      const hrs = hoursByPeriod[k];
      const w = weight[k];
      hrs.forEach((h, rankIdx) => {
        // top1 vale más que top2/top3 (3,2,1) * weight
        const rankScore = (3 - rankIdx) * w;
        count.set(h, (count.get(h) || 0) + rankScore);
      });
    });
    const sorted = Array.from(count.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => h)
      .slice(0, 3);
    if (sorted.length === 0) return "";
    if (sorted.length === 1)
      return `picos probables alrededor de las ${String(sorted[0]).padStart(
        2,
        "0"
      )}:00 (UTC-3)`;
    if (sorted.length === 2)
      return `picos probables alrededor de las ${String(sorted[0]).padStart(
        2,
        "0"
      )}:00 y ${String(sorted[1]).padStart(2, "0")}:00 (UTC-3)`;
    return `picos probables entre ${String(sorted[0]).padStart(
      2,
      "0"
    )}:00, ${String(sorted[1]).padStart(2, "0")}:00 y ${String(
      sorted[2]
    ).padStart(2, "0")}:00 (UTC-3)`;
  }, [hoursByPeriod]);

  return (
    <div className="grid gap-6">
      <AssetPeaksPeriod
        asset={asset}
        orderType={orderType}
        period="24h"
        onSummary={onSummary}
        onHours={onHours}
      />
      <AssetPeaksPeriod
        asset={asset}
        orderType={orderType}
        period="7d"
        onSummary={onSummary}
        onHours={onHours}
      />
      <AssetPeaksPeriod
        asset={asset}
        orderType={orderType}
        period="1m"
        onSummary={onSummary}
        onHours={onHours}
      />

      {/* Veredicto global */}
      <section className="p-4 -mt-2 rounded-xl border border-neutral-800 bg-neutral-900/60">
        <div className="text-lg font-semibold mb-1">
          {asset.toUpperCase()} — Veredicto global (24h · 7d · 1m)
        </div>
        <div className="text-sm text-neutral-300">📌 {globalVerdict}</div>
        {!!globalHours && (
          <div className="text-sm text-neutral-300 mt-1">
            ⏰ Además, {globalHours}.
          </div>
        )}
      </section>
    </div>
  );
}
