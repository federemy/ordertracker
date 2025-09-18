import { useMemo, useState } from "react";

type Direction = "UP" | "DOWN" | "MIX";

type FoundCycle = {
  startTs: number; // ms (UTC)
  endTs: number; // ms (UTC)
  hours: number;
  moveUsd: number; // max(high)-min(low) dentro de la ventana
  dir: Direction;
  startPrice: number;
  endPrice: number;
  minPrice: number;
  maxPrice: number;
};

function money(n: number, max = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  }).format(n);
}
function pct(a: number, b: number) {
  return b ? ((a - b) / b) * 100 : 0;
}
function toUTCMinus3(tsMs: number) {
  // Ajuste simple a UTC−3 (sin DST): restamos 3h
  return tsMs - 3 * 60 * 60 * 1000;
}
function fmtUTCm3(tsMs: number) {
  const d = new Date(toUTCMinus3(tsMs));
  // Fuerzo 24h y corto segundos
  return d.toLocaleString("es-AR", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchKlines1h(symbol: string, days: number) {
  // Binance limita a 1000 velas por request; 1h => ~41 días
  const limit = Math.min(24 * Math.max(1, Math.floor(days)), 1000);
  const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=1h&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`proxy ${r.status}: ${text?.slice(0, 120)}`);
  }
  const j = await r.json();
  if (!Array.isArray(j) || j.length === 0) throw new Error("Sin datos");
  // Kline: [openTime, open, high, low, close, volume, closeTime, ...]
  const rows = j as any[];
  return {
    openTime: rows.map((k) => Number(k[0])),
    closeTime: rows.map((k) => Number(k[6])),
    open: rows.map((k) => Number(k[1])),
    high: rows.map((k) => Number(k[2])),
    low: rows.map((k) => Number(k[3])),
    close: rows.map((k) => Number(k[4])),
  };
}

function analyzeCycles(
  openTime: number[],
  closeTime: number[],
  high: number[],
  low: number[],
  close: number[],
  targetUsd: number,
  windowHours: number
): FoundCycle[] {
  const n = close.length;
  const w = Math.max(1, Math.floor(windowHours)); // ventana en velas 1h
  const out: FoundCycle[] = [];

  if (n < w) return out;

  // Sliding window O(n * w) simple (w chico, p.ej. <= 24)
  for (let i = 0; i + w <= n; i++) {
    const hi = Math.max(...high.slice(i, i + w));
    const lo = Math.min(...low.slice(i, i + w));
    const range = hi - lo;

    if (range >= targetUsd) {
      // Direccionalidad: si el pico alto está al final y el bajo al inicio → UP (tendencia)
      const windowHighIdx = i + high.slice(i, i + w).indexOf(hi); // primer índice del máximo
      const windowLowIdx = i + low.slice(i, i + w).indexOf(lo); // primer índice del mínimo

      let dir: Direction = "MIX";
      if (windowLowIdx <= i + 1 && windowHighIdx >= i + w - 2) dir = "UP";
      else if (windowHighIdx <= i + 1 && windowLowIdx >= i + w - 2)
        dir = "DOWN";

      const startTs = openTime[i];
      const endTs = closeTime[i + w - 1];

      const startPrice = close[i];
      const endPrice = close[i + w - 1];

      out.push({
        startTs,
        endTs,
        hours: w,
        moveUsd: range,
        dir,
        startPrice,
        endPrice,
        minPrice: lo,
        maxPrice: hi,
      });
    }
  }

  // Mantengo solo los más recientes (p.ej. últimos 100 eventos)
  return out.slice(-100);
}

export default function CycleScanner({
  asset = "ETH",
  defaultTargetUsd = 800,
  defaultHours = 6,
  lookbackDays = 30,
}: {
  asset?: string;
  defaultTargetUsd?: number;
  defaultHours?: number;
  lookbackDays?: number; // hasta ~41d por límite de Binance (1h, 1000 velas)
}) {
  const symbol = useMemo(
    () => `${(asset || "ETH").toUpperCase()}USDT`,
    [asset]
  );

  const [targetUsd, setTargetUsd] = useState<number>(defaultTargetUsd);
  const [hours, setHours] = useState<number>(defaultHours);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<FoundCycle[] | null>(null);

  const foundCount = events?.length || 0;

  // Histograma por hora UTC−3 (del fin de ventana)
  const hourHist = useMemo(() => {
    const hist = new Array(24).fill(0);
    if (!events) return hist;
    events.forEach((e) => {
      const endUtcm3 = toUTCMinus3(e.endTs);
      const h = new Date(endUtcm3).getHours(); // 0-23 en UTC−3
      hist[h] += 1;
    });
    return hist;
  }, [events]);

  // Hora(s) más frecuentes (UTC−3)
  const hotHours = useMemo(() => {
    if (!events || events.length === 0) return [];
    const max = Math.max(...hourHist);
    if (max <= 0) return [];
    const hs: number[] = [];
    hourHist.forEach((v, i) => v === max && hs.push(i));
    return hs; // 0..23
  }, [hourHist, events]);

  const phrase = useMemo(() => {
    if (!events) return "Aún no se corrió la búsqueda.";
    if (events.length === 0)
      return `No se detectaron ciclos de ±${money(
        targetUsd
      )} dentro de ${hours}h en los últimos ${Math.min(
        lookbackDays,
        41
      )} días.`;

    // % UP vs DOWN
    const ups = events.filter((e) => e.dir === "UP").length;
    const downs = events.filter((e) => e.dir === "DOWN").length;
    const major =
      ups > downs ? "al alza" : downs > ups ? "a la baja" : "mixtos";

    const hs =
      hotHours.length > 0
        ? "horas más probables (UTC−3): " +
          hotHours.map((h) => String(h).padStart(2, "0")).join(", ")
        : "sin hora destacada";

    return `Se hallaron ${events.length} ciclos ≥ ${money(
      targetUsd
    )} en ≤ ${hours}h; predominan movimientos ${major}. Sugerencia de timing: ${hs}.`;
  }, [events, hotHours, targetUsd, hours, lookbackDays]);

  async function onSearch() {
    try {
      setLoading(true);
      setErr(null);
      setEvents(null);

      const data = await fetchKlines1h(symbol, Math.min(lookbackDays, 41));
      const res = analyzeCycles(
        data.openTime,
        data.closeTime,
        data.high,
        data.low,
        data.close,
        Math.max(1, Number(targetUsd) || 1),
        Math.max(1, Math.floor(Number(hours) || 1))
      );

      setEvents(res);
    } catch (e: any) {
      setErr(e?.message || "Error de red/APIs");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          {asset.toUpperCase()} — Buscador de ciclos
        </div>
        {loading && (
          <div className="hidden md:block text-xs text-neutral-400">
            Analizando…
          </div>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs text-neutral-400 mb-1">
            Movimiento objetivo (USD)
          </div>
          <input
            type="number"
            min={1}
            step={50}
            value={targetUsd}
            onChange={(e) =>
              setTargetUsd(Math.max(1, Number(e.target.value || 1)))
            }
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-32"
          />
        </div>
        <div>
          <div className="text-xs text-neutral-400 mb-1">Ventana (horas)</div>
          <input
            type="number"
            min={1}
            step={1}
            value={hours}
            onChange={(e) =>
              setHours(Math.max(1, Math.floor(Number(e.target.value || 1))))
            }
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-24"
          />
        </div>
        <div>
          <div className="text-xs text-neutral-400 mb-1">
            Lookback (días, máx 41)
          </div>
          <input
            type="number"
            min={1}
            max={41}
            step={1}
            value={Math.min(lookbackDays, 41)}
            onChange={() => {}}
            disabled
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 w-28 opacity-60 cursor-not-allowed"
            title="Limitado por el máximo de 1000 velas de Binance en 1 llamada"
          />
        </div>

        <button
          onClick={onSearch}
          disabled={loading}
          className={`px-4 py-2 rounded-xl text-sm font-semibold ${
            loading
              ? "opacity-50 cursor-not-allowed bg-white/10"
              : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
        >
          {loading ? "Buscando…" : "Buscar ciclo"}
        </button>
      </div>

      {/* Errores */}
      {err && <div className="text-sm text-rose-400">Error: {String(err)}</div>}

      {/* Resumen + Hot hours */}
      {events && (
        <div className="grid gap-2">
          <div className="text-sm text-neutral-300">{phrase}</div>

          {/* Mini histograma de horas (UTC−3) */}
          <div className="mt-1 grid grid-cols-12 gap-1">
            {hourHist.map((v, h) => (
              <div key={h} className="flex flex-col items-center gap-1">
                <div
                  className="w-full bg-emerald-600/30 rounded"
                  style={{ height: `${v * 10}px` }}
                  title={`h${String(h).padStart(2, "0")} → ${v}`}
                />
                <div className="text-[10px] text-neutral-400">
                  {String(h).padStart(2, "0")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla de últimos eventos */}
      {events && events.length > 0 && (
        <div className="rounded-xl overflow-auto border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/70 sticky top-0 backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left">Fin (UTC−3)</th>
                <th className="px-3 py-2 text-left">Inicio (UTC−3)</th>
                <th className="px-3 py-2 text-right">Horas</th>
                <th className="px-3 py-2 text-right">Move USD</th>
                <th className="px-3 py-2 text-left">Dirección</th>
                <th className="px-3 py-2 text-right">Precio ini</th>
                <th className="px-3 py-2 text-right">Precio fin</th>
                <th className="px-3 py-2 text-right">Min–Max</th>
                <th className="px-3 py-2 text-right">Δ% ventana</th>
              </tr>
            </thead>
            <tbody className="[&_tr:nth-child(even)]:bg-neutral-900/20">
              {events
                .slice()
                .reverse()
                .slice(0, 30)
                .map((e, i) => {
                  const deltaPct = pct(e.endPrice, e.startPrice);
                  return (
                    <tr key={i} className="border-t border-neutral-900/60">
                      <td className="px-3 py-2">{fmtUTCm3(e.endTs)}</td>
                      <td className="px-3 py-2">{fmtUTCm3(e.startTs)}</td>
                      <td className="px-3 py-2 text-right">{e.hours}</td>
                      <td className="px-3 py-2 text-right">
                        {money(e.moveUsd)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs border ${
                            e.dir === "UP"
                              ? "bg-emerald-600/20 text-emerald-300 border-emerald-600/40"
                              : e.dir === "DOWN"
                              ? "bg-rose-600/20 text-rose-300 border-rose-600/40"
                              : "bg-neutral-800 text-neutral-300 border-neutral-700"
                          }`}
                        >
                          {e.dir === "UP"
                            ? "Alcista"
                            : e.dir === "DOWN"
                            ? "Bajista"
                            : "Mixto"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(e.startPrice, 2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(e.endPrice, 2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(e.minPrice, 2)} → {money(e.maxPrice, 2)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          deltaPct >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {(deltaPct >= 0 ? "+" : "") + deltaPct.toFixed(2) + "%"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Si no hay eventos */}
      {events && foundCount === 0 && (
        <div className="text-sm text-neutral-400">
          Sin coincidencias con los parámetros actuales. Probá bajar el objetivo
          USD o ampliar la ventana de horas.
        </div>
      )}
    </section>
  );
}
