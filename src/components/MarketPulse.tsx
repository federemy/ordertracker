// src/components/MarketPulse.tsx
// Componente 100% texto. Sin gráficos.
// - Usa tu proxy `/.netlify/functions/binance-proxy` para klines.
// - Mes: 1h (limit=720). Largo: 4h (limit=1000 ≈ ~166 días).
// - Horas expresadas en UTC-3.
// - Sección de noticias es opcional (requiere `/.netlify/functions/crypto-news`).

import { useEffect, useMemo, useState } from "react";

type NewsItem = { title: string };
type NewsPayload = { items: NewsItem[] };

function fmtHour(h: number) {
  // h es 0..23 UTC-3
  const hh = h.toString().padStart(2, "0");
  return `${hh}:00`;
}

function toUTCMinus3Hour(msOpen: number) {
  const d = new Date(msOpen);
  // Hora UTC
  const hUTC = d.getUTCHours();
  // Ajuste -3
  return (hUTC + 24 - 3) % 24;
}

async function fetchKlines(symbol: string, interval: string, limit: number) {
  const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`binance-proxy ${r.status}`);
  return (await r.json()) as any[];
}

function topHoursSummary(
  rows: { hour: number; upAvg: number; downAvg: number; volAvg: number }[],
  want: "up" | "down",
  k: number
) {
  const sorted =
    want === "up"
      ? [...rows].sort((a, b) => b.upAvg - a.upAvg)
      : [...rows].sort((a, b) => a.downAvg - b.downAvg);
  return sorted.slice(0, k).map((r) => r.hour);
}

// Heurística textual para armar 1–3 frases cortas
function buildHourVerdictText(
  label: string,
  ups: number[],
  downs: number[]
): string[] {
  const upsTxt = ups.map(fmtHour).join(", ");
  const downsTxt = downs.map(fmtHour).join(", ");

  const lines: string[] = [];
  if (ups.length && downs.length) {
    lines.push(
      `${label}: subas frecuentes cerca de ${upsTxt}; bajas marcadas cerca de ${downsTxt} (UTC-3).`
    );
  } else if (ups.length) {
    lines.push(
      `${label}: mayor probabilidad de subas cerca de ${upsTxt} (UTC-3).`
    );
  } else if (downs.length) {
    lines.push(
      `${label}: mayor probabilidad de bajas cerca de ${downsTxt} (UTC-3).`
    );
  } else {
    lines.push(`${label}: sin patrón horario claro en el período analizado.`);
  }
  return lines;
}

// Mini análisis de titulares (muy simple, por palabras clave)
function newsSentiment(lines: string[]) {
  const bull = [
    "rally",
    "surge",
    "jump",
    "breaks",
    "ETF inflow",
    "approval",
    "up",
  ];
  const bear = ["dump", "crash", "hack", "ban", "outflow", "lawsuit", "down"];
  let score = 0;
  for (const t of lines) {
    const s = t.toLowerCase();
    if (bull.some((w) => s.includes(w))) score += 1;
    if (bear.some((w) => s.includes(w))) score -= 1;
  }
  if (score >= 2)
    return "Las noticias de la última hora se inclinan levemente al alza.";
  if (score <= -2)
    return "Las noticias de la última hora se inclinan levemente a la baja.";
  if (score > 0) return "Titulares mixtos con sesgo alcista leve.";
  if (score < 0) return "Titulares mixtos con sesgo bajista leve.";
  return "Titulares neutrales/mixtos sin dirección clara.";
}

export default function MarketPulse({
  asset = "ETH",
  symbol = "ETHUSDT",
}: {
  asset?: string;
  symbol?: string; // por si querés BTCUSDT, etc.
}) {
  const [linesMonth, setLinesMonth] = useState<string[] | null>(null);
  const [linesYearish, setLinesYearish] = useState<string[] | null>(null);
  const [newsLine, setNewsLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(
    () => `${asset.toUpperCase()} — Horarios probables de movimientos`,
    [asset]
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        // === 1) ÚLTIMO MES: 1h, limit ~720
        const m = await fetchKlines(symbol, "1h", 720);
        // m[i] = [openTime, open, high, low, close, ...]
        const bucketsM = Array.from({ length: 24 }, () => ({
          upSum: 0,
          upCnt: 0,
          downSum: 0,
          downCnt: 0,
          volSum: 0,
          volCnt: 0,
        }));
        for (const k of m) {
          const o = Number(k[1]);
          const c = Number(k[4]);
          const h = toUTCMinus3Hour(Number(k[0]));
          if (!isFinite(o) || !isFinite(c)) continue;
          const ch = c - o;
          const vol = Math.abs(ch / (o || 1));
          if (ch > 0) {
            bucketsM[h].upSum += ch;
            bucketsM[h].upCnt += 1;
          } else if (ch < 0) {
            bucketsM[h].downSum += ch; // negativo
            bucketsM[h].downCnt += 1;
          }
          bucketsM[h].volSum += vol;
          bucketsM[h].volCnt += 1;
        }
        const rowsM = bucketsM.map((b, h) => ({
          hour: h,
          upAvg: b.upCnt ? b.upSum / b.upCnt : 0,
          downAvg: b.downCnt ? b.downSum / b.downCnt : 0, // negativo
          volAvg: b.volCnt ? b.volSum / b.volCnt : 0,
        }));
        const upsM = topHoursSummary(rowsM, "up", 3);
        const downsM = topHoursSummary(rowsM, "down", 3);
        const monthText = buildHourVerdictText("Último mes", upsM, downsM);
        if (!cancel) setLinesMonth(monthText);

        // === 2) LARGO PLAZO (aprox ~6 meses por límite): 4h, limit=1000
        // (No alcanza 1 año entero con una sola llamada, pero da una vista “anual-lite”)
        const y = await fetchKlines(symbol, "4h", 1000);
        const bucketsY = Array.from({ length: 24 }, () => ({
          upSum: 0,
          upCnt: 0,
          downSum: 0,
          downCnt: 0,
          volSum: 0,
          volCnt: 0,
        }));
        for (const k of y) {
          const o = Number(k[1]);
          const c = Number(k[4]);
          const openH = toUTCMinus3Hour(Number(k[0]));
          // Para 4h, marcamos el bloque entero en el horario de apertura
          const h = openH;
          if (!isFinite(o) || !isFinite(c)) continue;
          const ch = c - o;
          const vol = Math.abs(ch / (o || 1));
          if (ch > 0) {
            bucketsY[h].upSum += ch;
            bucketsY[h].upCnt += 1;
          } else if (ch < 0) {
            bucketsY[h].downSum += ch;
            bucketsY[h].downCnt += 1;
          }
          bucketsY[h].volSum += vol;
          bucketsY[h].volCnt += 1;
        }
        const rowsY = bucketsY.map((b, h) => ({
          hour: h,
          upAvg: b.upCnt ? b.upSum / b.upCnt : 0,
          downAvg: b.downCnt ? b.downSum / b.downCnt : 0,
          volAvg: b.volCnt ? b.volSum / b.volCnt : 0,
        }));
        const upsY = topHoursSummary(rowsY, "up", 3);
        const downsY = topHoursSummary(rowsY, "down", 3);
        const yearText = buildHourVerdictText(
          "Plazo largo (~6 meses)",
          upsY,
          downsY
        );
        if (!cancel) setLinesYearish(yearText);

        // === 3) Noticias (opcional). Si no existe la función, se ignora.
        try {
          const r = await fetch("/.netlify/functions/crypto-news?minutes=60");
          if (r.ok) {
            const json = (await r.json()) as NewsPayload;
            const titles = (json?.items || [])
              .map((i) => i.title)
              .filter(Boolean);
            if (titles.length) {
              const verdict = newsSentiment(titles);
              if (!cancel) setNewsLine(verdict);
            } else {
              if (!cancel) setNewsLine(null);
            }
          } else {
            // silencioso si 404/500
            if (!cancel) setNewsLine(null);
          }
        } catch {
          if (!cancel) setNewsLine(null);
        }
      } catch (e: any) {
        if (!cancel) {
          setErr(e?.message || "Error calculando patrones horarios.");
          setLinesMonth(null);
          setLinesYearish(null);
          setNewsLine(null);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [asset, symbol]);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 grid gap-2">
      <div className="text-lg font-semibold">{title}</div>
      {loading && <div className="text-sm text-neutral-400">Analizando…</div>}
      {err && <div className="text-sm text-rose-400">Error: {err}</div>}

      {/* Frases (1–3) para el mes */}
      {linesMonth?.map((l, i) => (
        <p key={`m-${i}`} className="text-sm text-neutral-200">
          {l}
        </p>
      ))}

      {/* Frases (1–3) para el “anual-lite” */}
      {linesYearish?.map((l, i) => (
        <p key={`y-${i}`} className="text-sm text-neutral-200">
          {l}
        </p>
      ))}

      {/* Noticias (opcional) */}
      {newsLine && (
        <p className="text-sm text-neutral-300">
          Noticias (última hora): {newsLine}
        </p>
      )}

      {/* Nota breve para expectativas */}
      <p className="text-[11px] text-neutral-500">
        *Horarios basados en velas 1h (último mes) y 4h (~6 meses aprox.).
        Pistas probabilísticas, no garantía. UTC-3.
      </p>
    </section>
  );
}
