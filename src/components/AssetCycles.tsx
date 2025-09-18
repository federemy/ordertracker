import { useEffect, useMemo, useState } from "react";

/** === Tipos / utilidades === */
type PeriodKey = "24h" | "7d" | "30d";
const PERIOD_LIMITS: Record<PeriodKey, number> = {
  "24h": 48, // 48 velas de 1h para tener colchón
  "7d": 7 * 24,
  "30d": 30 * 24,
};

function fmtMoney(n: number, frac: number = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: frac,
  }).format(n);
}
function fmtH(ms: number) {
  const h = ms / 3600000;
  return h >= 24 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`;
}
function toLocal(dt: number) {
  try {
    return new Date(dt).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour12: false,
    });
  } catch {
    return new Date(dt).toLocaleString();
  }
}

// Usa tu proxy Netlify para evitar CORS/bloqueos
async function fetchKlines1h(symbol: string, limit: number) {
  const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=1h&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`proxy ${r.status}`);
  return (await r.json()) as any[];
}

/** Swing detectado por umbral (zigzag simple) */
type Swing = {
  dir: "up" | "down";
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  delta: number; // USD (con signo)
  durationMs: number;
};

/** Detector de swings por umbral absoluto en USD sobre CIERRE 1h */
function detectSwings(
  closes: number[],
  times: number[],
  thresholdUsd: number
): Swing[] {
  const swings: Swing[] = [];
  if (closes.length < 3) return swings;

  // Semilla: arrancamos tomando el primer punto como “extremo actual”
  let i0 = 0;
  let p0 = closes[0];

  // Direction unknown initially; iremos confirmando al romper el umbral
  let mode: "seekUp" | "seekDown" | "undecided" = "undecided";

  for (let i = 1; i < closes.length; i++) {
    const p = closes[i];
    const diff = p - p0;

    // Si aún no hay dirección, elegimos cuando supera el umbral
    if (mode === "undecided") {
      if (diff >= thresholdUsd) {
        // confirmado swing alcista
        swings.push({
          dir: "up",
          startTime: times[i0],
          endTime: times[i],
          startPrice: p0,
          endPrice: p,
          delta: diff,
          durationMs: times[i] - times[i0],
        });
        i0 = i; // el nuevo extremo es este punto
        p0 = p;
        mode = "seekDown";
        continue;
      }
      if (-diff >= thresholdUsd) {
        // confirmado swing bajista
        swings.push({
          dir: "down",
          startTime: times[i0],
          endTime: times[i],
          startPrice: p0,
          endPrice: p,
          delta: diff, // negativo
          durationMs: times[i] - times[i0],
        });
        i0 = i;
        p0 = p;
        mode = "seekUp";
        continue;
      }
      // si no superó umbral, pero se aleja más, actualizamos extremo
      if (p < p0) {
        i0 = i;
        p0 = p;
      } else if (p > p0) {
        i0 = i;
        p0 = p;
      }
      continue;
    }

    // Si ya tenemos un modo, buscamos el siguiente rompimiento de umbral opuesto
    if (mode === "seekUp") {
      const upDiff = p - p0;
      if (upDiff >= thresholdUsd) {
        swings.push({
          dir: "up",
          startTime: times[i0],
          endTime: times[i],
          startPrice: p0,
          endPrice: p,
          delta: upDiff,
          durationMs: times[i] - times[i0],
        });
        i0 = i;
        p0 = p;
        mode = "seekDown";
      } else {
        // mantener el extremo inferior mientras siga bajando
        if (p < p0) {
          i0 = i;
          p0 = p;
        }
      }
    } else if (mode === "seekDown") {
      const downDiff = p - p0; // negativo si baja
      if (-downDiff >= thresholdUsd) {
        swings.push({
          dir: "down",
          startTime: times[i0],
          endTime: times[i],
          startPrice: p0,
          endPrice: p,
          delta: downDiff,
          durationMs: times[i] - times[i0],
        });
        i0 = i;
        p0 = p;
        mode = "seekUp";
      } else {
        // mantener el extremo superior mientras siga subiendo
        if (p > p0) {
          i0 = i;
          p0 = p;
        }
      }
    }
  }
  return swings;
}

/** === Componente principal === */
export default function AssetCycles({
  asset = "ETH",
  thresholdUsd: thresholdProp = 800,
  defaultPeriod = "30d",
  refreshKey,
}: {
  asset?: string;
  thresholdUsd?: number;
  defaultPeriod?: PeriodKey;
  /** si lo pasás desde Home, podés refrescar cada 10 min como EthIntraday */
  refreshKey?: number | string;
}) {
  const symbol = useMemo(
    () => `${(asset || "ETH").toUpperCase()}USDT`,
    [asset]
  );

  const [period, setPeriod] = useState<PeriodKey>(defaultPeriod);
  const [threshold, setThreshold] = useState<number>(thresholdProp);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [swings, setSwings] = useState<Swing[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setErr(null);
        setSwings(null);

        const limit = PERIOD_LIMITS[period];
        const data = await fetchKlines1h(symbol, limit);

        // tomamos cierre y tiempo de cierre (kline[6] o [0] según tu proxy; usamos [0] openTime y sumamos 1h)
        const closes = data
          .map((k: any) => Number(k[4]))
          .filter(Number.isFinite);
        const times = data.map((k: any) => Number(k[0]) + 60 * 60 * 1000);

        if (closes.length < 3) throw new Error("Datos insuficientes");

        const ss = detectSwings(closes, times, Math.max(1, threshold));
        if (!cancelled) setSwings(ss);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Error de red/APIs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [symbol, period, threshold, refreshKey]);

  // KPIs de resumen
  const summary = useMemo(() => {
    if (!swings || swings.length === 0) return null;

    const durations = swings.map((s) => s.durationMs);
    const deltas = swings.map((s) => Math.abs(s.delta));
    const avgDur =
      durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
    const avgDelta =
      deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);

    // intervalo promedio entre inicios de swings
    const starts = swings.map((s) => s.startTime).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < starts.length; i++)
      gaps.push(starts[i] - starts[i - 1]);
    const avgGap = gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : avgDur;

    const lastSwing = swings[swings.length - 1];
    const lastAgoMs = Date.now() - lastSwing.endTime;

    return {
      count: swings.length,
      avgDur,
      avgDelta,
      avgGap,
      lastSwing,
      lastAgoMs,
    };
  }, [swings]);

  const Verdict = () => {
    if (!summary) return null;

    // frase muy simple
    const frec =
      summary.avgGap >= 24 * 3600000
        ? `${(summary.avgGap / 3600000 / 24).toFixed(1)} días`
        : `${(summary.avgGap / 3600000).toFixed(1)} h`;

    const tam = fmtMoney(summary.avgDelta, 0);

    return (
      <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 text-sm">
        <div className="font-semibold mb-1">
          Veredicto de ciclos (umbral ±{fmtMoney(threshold, 0)})
        </div>
        <div className="text-neutral-300">
          En promedio, un movimiento de ±{fmtMoney(threshold, 0)} aparece cada{" "}
          <b>{frec}</b>. El tamaño medio de esos swings es <b>{tam}</b> y la
          duración típica es <b>{fmtH(summary.avgDur)}</b>.{" "}
          <span className="text-neutral-400">
            (Último swing {fmtH(summary.lastAgoMs)} atrás)
          </span>
        </div>
      </div>
    );
  };

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          {asset.toUpperCase()} — Ciclos (1h)
        </div>
        {loading && (
          <div className="hidden md:block text-xs text-neutral-400">
            Analizando…
          </div>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-neutral-400">Período</label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700"
        >
          <option value="24h">24h</option>
          <option value="7d">7 días</option>
          <option value="30d">1 mes</option>
        </select>

        <label className="text-neutral-400 ml-2">Umbral (USD)</label>
        <input
          type="number"
          min={50}
          step={50}
          value={threshold}
          onChange={(e) =>
            setThreshold(Math.max(1, Number(e.target.value || 1)))
          }
          className="w-28 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-right"
        />
      </div>

      {err && <div className="text-sm text-rose-400">Error: {String(err)}</div>}
      {!err && !swings && (
        <div className="text-sm text-neutral-400">Cargando…</div>
      )}

      {swings && swings.length === 0 && (
        <div className="text-sm text-neutral-300">
          No hubo swings de ±{fmtMoney(threshold, 0)} en este período.
        </div>
      )}

      {/* Resumen / veredicto */}
      {swings && swings.length > 0 && <Verdict />}

      {/* Lista de últimos swings */}
      {swings && swings.length > 0 && (
        <div className="grid gap-2">
          <div className="text-sm text-neutral-400">
            Últimos swings ≥ ±{fmtMoney(threshold, 0)} ({swings.length})
          </div>
          <div className="overflow-auto border border-neutral-800 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900/70">
                <tr>
                  <th className="px-3 py-2 text-left">Dirección</th>
                  <th className="px-3 py-2 text-left">Inicio (UTC−3)</th>
                  <th className="px-3 py-2 text-left">Fin (UTC−3)</th>
                  <th className="px-3 py-2 text-right">Δ USD</th>
                  <th className="px-3 py-2 text-right">Duración</th>
                </tr>
              </thead>
              <tbody className="[&_tr:nth-child(even)]:bg-neutral-900/20">
                {swings
                  .slice()
                  .reverse()
                  .map((s, i) => (
                    <tr key={i} className="border-t border-neutral-900/60">
                      <td className="px-3 py-2">
                        <span
                          className={
                            "px-2 py-0.5 rounded-full text-xs font-semibold border " +
                            (s.dir === "up"
                              ? "bg-emerald-600/15 text-emerald-300 border-emerald-700/40"
                              : "bg-rose-600/15 text-rose-300 border-rose-700/40")
                          }
                        >
                          {s.dir === "up" ? "Subida" : "Bajada"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{toLocal(s.startTime)}</td>
                      <td className="px-3 py-2">{toLocal(s.endTime)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtMoney(Math.abs(s.delta), 0)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtH(s.durationMs)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
