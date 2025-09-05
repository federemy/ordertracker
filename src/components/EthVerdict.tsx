// src/components/EthVerdict.tsx
import { useState } from "react";
import type { EthAnalysis } from "./EthIntraday";

type VerdictDir = "sube" | "baja" | "lateral";
type Mode = "simple" | "full";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function labelConf(c: number) {
  return c >= 75 ? "alta" : c >= 45 ? "media" : "baja";
}
function arrow(bias?: string) {
  return bias === "Alcista" ? "↑" : bias === "Bajista" ? "↓" : "→";
}
function money(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function scoreFrom(data: EthAnalysis) {
  const s = data.short; // 5m
  const d = data.day; // 1h
  let score = 0;
  const reasons: string[] = [];

  // Sesgo por medias
  if (s.bias === "Alcista") {
    score += 2;
    reasons.push("5m: SMA rápida > lenta");
  }
  if (s.bias === "Bajista") {
    score -= 2;
    reasons.push("5m: SMA rápida < lenta");
  }
  if (d.bias === "Alcista") {
    score += 2;
    reasons.push("1h: SMA(6) > SMA(24)");
  }
  if (d.bias === "Bajista") {
    score -= 2;
    reasons.push("1h: SMA(6) < SMA(24)");
  }

  // Momento
  if (s.pct > 0.3) {
    score += 1;
    reasons.push(`5m +${s.pct.toFixed(2)}%`);
  }
  if (s.pct < -0.3) {
    score -= 1;
    reasons.push(`5m ${s.pct.toFixed(2)}%`);
  }
  if (d.pct > 0.5) {
    score += 1;
    reasons.push(`1h +${d.pct.toFixed(2)}%`);
  }
  if (d.pct < -0.5) {
    score -= 1;
    reasons.push(`1h ${d.pct.toFixed(2)}%`);
  }

  // Estructura intradía
  if (s.smaFast != null && s.smaSlow != null) {
    if (data.last > s.smaFast && s.smaFast > s.smaSlow) {
      score += 1;
      reasons.push("Precio > SMA rápida > lenta");
    } else if (data.last < s.smaFast && s.smaFast < s.smaSlow) {
      score -= 1;
      reasons.push("Precio < SMA rápida < lenta");
    }
  }

  // Posición en rango diario
  if (d.max > d.min) {
    const pos = (data.last - d.min) / (d.max - d.min);
    if (pos < 0.2 && (s.bias === "Alcista" || d.bias === "Alcista")) {
      score += 1;
      reasons.push("Cerca del piso diario (sesgo alcista)");
    } else if (pos > 0.8 && (s.bias === "Bajista" || d.bias === "Bajista")) {
      score -= 1;
      reasons.push("Cerca del techo diario (sesgo bajista)");
    }
  }

  score = clamp(score, -6, 6);
  const confidence = Math.round((Math.abs(score) / 6) * 100);
  let dir: VerdictDir = "lateral";
  if (score >= 2) dir = "sube";
  if (score <= -2) dir = "baja";
  return { dir, confidence, reasons };
}

export default function EthVerdict({
  data,
  mode = "simple",
}: {
  data?: EthAnalysis | null;
  mode?: Mode;
}) {
  const [show, setShow] = useState(mode === "full");
  if (!data) return null;

  const v = scoreFrom(data);
  const s = data.short;
  const d = data.day;
  const l = (data as any).long as EthAnalysis["day"] | undefined; // opcional, si agregás 1d·30d

  const cls =
    v.dir === "sube"
      ? "bg-emerald-600/15 text-emerald-300 border-emerald-700/40"
      : v.dir === "baja"
      ? "bg-rose-600/15 text-rose-300 border-rose-700/40"
      : "bg-neutral-800 text-neutral-200 border-neutral-700";

  const mid = d.max > d.min ? (d.min + d.max) / 2 : data.last;
  const objetivo = v.dir === "sube" ? d.max : v.dir === "baja" ? d.min : mid;
  const invalidacion = d.smaSlow ?? mid;

  const headline =
    v.dir === "sube"
      ? "Probable continuidad alcista a corto plazo."
      : v.dir === "baja"
      ? "Probable continuidad bajista a corto plazo."
      : "Movimiento lateral/indefinido ahora.";

  const simpleLine =
    v.dir === "sube"
      ? `Sesgo alcista. Objetivo: ${money(objetivo)} · Inval.: ${money(
          invalidacion
        )}`
      : v.dir === "baja"
      ? `Sesgo bajista. Objetivo: ${money(objetivo)} · Inval.: ${money(
          invalidacion
        )}`
      : `Rango. Vigilar ${money(d.min)}–${money(d.max)} · Centro ${money(mid)}`;

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">ETH — Veredicto</div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}
          >
            {v.confidence}% confianza · {labelConf(v.confidence)}
          </span>
          <button
            onClick={() => setShow((x) => !x)}
            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20"
            aria-expanded={show}
          >
            {show ? "Ocultar" : "Ver detalles"}
          </button>
        </div>
      </div>

      {/* Mensaje corto */}
      <div className="text-base">
        {v.dir === "sube" && (
          <>
            Según las señales, <b>va a subir</b>. {headline}
          </>
        )}
        {v.dir === "baja" && (
          <>
            Según las señales, <b>va a seguir bajando</b>. {headline}
          </>
        )}
        {v.dir === "lateral" && (
          <>
            Según las señales, <b>no hay dirección clara</b>. {headline}
          </>
        )}
      </div>

      {/* Línea compacta */}
      <div className="text-sm text-neutral-300">{simpleLine}</div>

      {/* Chips multi-marco: corto/mediano/(largo si hay) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700">
          5m: {arrow(s.bias)} {s.bias}
        </span>
        <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700">
          1h: {arrow(d.bias)} {d.bias}
        </span>
        {l && (
          <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700">
            1d: {arrow(l.bias)} {l.bias}
          </span>
        )}
      </div>

      {/* Barra confianza */}
      <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={
            "h-full " +
            (v.dir === "sube"
              ? "bg-emerald-500"
              : v.dir === "baja"
              ? "bg-rose-500"
              : "bg-neutral-500")
          }
          style={{ width: `${v.confidence}%`, transition: "width 300ms ease" }}
        />
      </div>

      {/* Detalles (mostrados sólo en modo "full" o al expandir) */}
      {show && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400 text-xs">Precio</div>
              <div className="font-semibold tabular-nums">
                {money(data.last)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400 text-xs">Objetivo inmediato</div>
              <div className="font-semibold tabular-nums">
                {money(objetivo)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="text-neutral-400 text-xs">Invalidación</div>
              <div className="font-semibold tabular-nums">
                {money(invalidacion)}
              </div>
            </div>
          </div>

          {!!scoreFrom(data).reasons.length && (
            <ul className="text-xs text-neutral-400 list-disc pl-5 space-y-1">
              {scoreFrom(data).reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          <div className="text-xs text-neutral-500">
            *Heurística educativa basada en medias, % de cambio y rango de 24h.
            No es recomendación financiera.
          </div>
        </>
      )}
    </section>
  );
}
