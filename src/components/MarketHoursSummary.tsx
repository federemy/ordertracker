import { useEffect, useMemo, useState } from "react";

type OrderSide = "BUY" | "SELL";

function fmtHour(h: number) {
  const hh = h.toString().padStart(2, "0");
  return `${hh}:00`;
}
function toUTCMinus3Hour(msOpen: number) {
  const d = new Date(msOpen);
  return (d.getUTCHours() + 24 - 3) % 24; // UTC-3
}
async function fetchKlines(symbol: string, interval: string, limit: number) {
  const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`binance-proxy ${r.status}`);
  return (await r.json()) as any[]; // [openTime, open, high, low, close, ...]
}

function buildBuckets() {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    upSum: 0,
    upCnt: 0,
    downSum: 0,
    downCnt: 0,
  }));
}
function digest(rows: any[], useOpenHour = true) {
  const buckets = buildBuckets();
  for (const k of rows) {
    const o = Number(k[1]);
    const c = Number(k[4]);
    if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
    const ch = c - o;
    const h = toUTCMinus3Hour(Number(k[0]));
    const idx = useOpenHour ? h : toUTCMinus3Hour(Number(k[6] ?? k[0])); // fallback
    const b = buckets[idx];
    if (ch > 0) {
      b.upSum += ch;
      b.upCnt += 1;
    } else if (ch < 0) {
      b.downSum += ch;
      b.downCnt += 1;
    }
  }
  return buckets.map((b) => ({
    hour: b.hour,
    upAvg: b.upCnt ? b.upSum / b.upCnt : 0,
    downAvg: b.downCnt ? b.downSum / b.downCnt : 0, // negativo
  }));
}
function topHours(
  rows: { hour: number; upAvg: number; downAvg: number }[],
  want: "up" | "down",
  k = 3
) {
  const sorted =
    want === "up"
      ? [...rows].sort((a, b) => b.upAvg - a.upAvg)
      : [...rows].sort((a, b) => a.downAvg - b.downAvg); // más negativo primero
  return sorted.slice(0, k).map((r) => r.hour);
}

function buildText(
  label: string,
  ups: number[],
  downs: number[],
  side?: OrderSide
) {
  const upTxt = ups.length ? ups.map(fmtHour).join(", ") : "";
  const downTxt = downs.length ? downs.map(fmtHour).join(", ") : "";

  // 1 a 3 frases, priorizando según la orden:
  const lines: string[] = [];
  if (side === "SELL") {
    if (downs.length) {
      lines.push(
        `${label}: las caídas suelen darse cerca de ${downTxt} (UTC-3).`
      );
    }
    if (ups.length) {
      lines.push(
        `Ojo con rebotes: subas habituales cerca de ${upTxt} (UTC-3).`
      );
    }
    if (!ups.length && !downs.length) {
      lines.push(`${label}: sin patrón horario claro.`);
    }
  } else if (side === "BUY") {
    if (ups.length) {
      lines.push(`${label}: las subas suelen darse cerca de ${upTxt} (UTC-3).`);
    }
    if (downs.length) {
      lines.push(`Posibles retrocesos cerca de ${downTxt} (UTC-3).`);
    }
    if (!ups.length && !downs.length) {
      lines.push(`${label}: sin patrón horario claro.`);
    }
  } else {
    if (ups.length && downs.length) {
      lines.push(
        `${label}: subas frecuentes ${upTxt}; bajas marcadas ${downTxt} (UTC-3).`
      );
    } else if (ups.length) {
      lines.push(
        `${label}: mayor probabilidad de subas cerca de ${upTxt} (UTC-3).`
      );
    } else if (downs.length) {
      lines.push(
        `${label}: mayor probabilidad de bajas cerca de ${downTxt} (UTC-3).`
      );
    } else {
      lines.push(`${label}: sin patrón horario claro.`);
    }
  }
  return lines;
}

export default function MarketHoursSummary({
  asset = "ETH",
  symbol = "ETHUSDT",
  orderSide, // BUY | SELL (prioriza altas/bajas)
  refreshKey,
}: {
  asset?: string;
  symbol?: string;
  orderSide?: OrderSide;
  refreshKey?: number | string;
}) {
  const [linesDay, setLinesDay] = useState<string[] | null>(null);
  const [linesWeek, setLinesWeek] = useState<string[] | null>(null);
  const [linesMonth, setLinesMonth] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(
    () => `${asset.toUpperCase()} — Horarios probables (24h / 7d / 1m)`,
    [asset]
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // === 24h: 15m x 96
        const d = await fetchKlines(symbol, "15m", 96);
        const rowsD = digest(d, true);
        const upsD = topHours(rowsD, "up", 3);
        const downsD = topHours(rowsD, "down", 3);
        if (!cancel)
          setLinesDay(buildText("Últimas 24h", upsD, downsD, orderSide));

        // === 7d: 1h x 168
        const w = await fetchKlines(symbol, "1h", 24 * 7);
        const rowsW = digest(w, true);
        const upsW = topHours(rowsW, "up", 3);
        const downsW = topHours(rowsW, "down", 3);
        if (!cancel)
          setLinesWeek(buildText("Últimos 7 días", upsW, downsW, orderSide));

        // === 1m: 1h x 720
        const m = await fetchKlines(symbol, "1h", 720);
        const rowsM = digest(m, true);
        const upsM = topHours(rowsM, "up", 3);
        const downsM = topHours(rowsM, "down", 3);
        if (!cancel)
          setLinesMonth(buildText("Último mes", upsM, downsM, orderSide));
      } catch (e: any) {
        if (!cancel) {
          setErr(e?.message || "Error calculando patrones horarios.");
          setLinesDay(null);
          setLinesWeek(null);
          setLinesMonth(null);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [asset, symbol, orderSide, refreshKey]);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 grid gap-2">
      <div className="text-lg font-semibold">{title}</div>
      {loading && <div className="text-sm text-neutral-400">Analizando…</div>}
      {err && <div className="text-sm text-rose-400">Error: {err}</div>}

      {linesDay?.map((l, i) => (
        <p key={`d-${i}`} className="text-sm text-neutral-200">
          {l}
        </p>
      ))}
      {linesWeek?.map((l, i) => (
        <p key={`w-${i}`} className="text-sm text-neutral-200">
          {l}
        </p>
      ))}
      {linesMonth?.map((l, i) => (
        <p key={`m-${i}`} className="text-sm text-neutral-200">
          {l}
        </p>
      ))}
    </section>
  );
}
