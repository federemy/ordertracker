import React from "react";
import type { EthAnalysis } from "./EthIntraday";

type VerdictDir = "sube" | "baja" | "lateral";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function labelConf(c: number) {
  if (c >= 75) return "alta";
  if (c >= 45) return "media";
  return "baja";
}

function arrow(bias: string) {
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
  const s = data.short; // 5m (~3h)
  const d = data.day; // 1h (24h)
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

  // Momento (% ventana)
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

  // Estructura (precio vs medias intradía)
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
    const pos = (data.last - d.min) / (d.max - d.min); // 0 piso, 1 techo
    if (pos < 0.2 && (s.bias === "Alcista" || d.bias === "Alcista")) {
      score += 1;
      reasons.push("Cerca del piso diario con sesgo alcista");
    } else if (pos > 0.8 && (s.bias === "Bajista" || d.bias === "Bajista")) {
      score -= 1;
      reasons.push("Cerca del techo diario con sesgo bajista");
    }
  }

  score = clamp(score, -6, 6);
  const confidence = Math.round((Math.abs(score) / 6) * 100);

  let dir: VerdictDir = "lateral";
  if (score >= 2) dir = "sube";
  if (score <= -2) dir = "baja";

  return { dir, confidence, reasons };
}

export default function EthVerdict({ data }: { data?: EthAnalysis | null }) {
  if (!data) return null;

  const v = scoreFrom(data);
  const s = data.short;
  const d = data.day;

  const cls =
    v.dir === "sube"
      ? "bg-emerald-600/15 text-emerald-300 border-emerald-700/40"
      : v.dir === "baja"
      ? "bg-rose-600/15 text-rose-300 border-rose-700/40"
      : "bg-neutral-800 text-neutral-200 border-neutral-700";

  // Niveles clave (del rango de 24h)
  const mid = d.max > d.min ? (d.min + d.max) / 2 : data.last;
  const objetivo = v.dir === "sube" ? d.max : v.dir === "baja" ? d.min : mid;
  const invalidacion =
    v.dir === "sube"
      ? d.smaSlow ?? mid // si pierde SMA lenta 1h, se debilita
      : v.dir === "baja"
      ? d.smaSlow ?? mid // si recupera sobre SMA lenta, se debilita el bajista
      : mid;

  const headline =
    v.dir === "sube"
      ? "Probable continuidad alcista a corto plazo."
      : v.dir === "baja"
      ? "Probable continuidad bajista a corto plazo."
      : "Movimiento lateral/indefinido ahora.";

  // Qué confirmaría o invalidaría
  const queObservar =
    v.dir === "sube"
      ? `Confirmaría: cierres 5m por encima de ${money(
          d.smaFast ?? mid
        )} y ataque a ${money(d.max)}. Invalidación: perder ${money(
          invalidacion
        )} con volúmenes crecientes.`
      : v.dir === "baja"
      ? `Confirmaría: rechazos bajo ${money(
          d.smaFast ?? mid
        )} y pérdida de ${money(
          d.min
        )}. Invalidación: recuperación sostenida sobre ${money(invalidacion)}.`
      : `Confirmaría: salida del rango ${money(d.min)}–${money(
          d.max
        )}. Invalidación: vuelta al centro del rango (~${money(mid)}).`;

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">ETH — Veredicto</div>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}
        >
          {v.confidence}% confianza · {labelConf(v.confidence)}
        </span>
      </div>

      {/* Frase corta + semáforo */}
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

      {/* Alineación de marcos (chips 5m/1h) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700">
          5m: {arrow(s.bias)} {s.bias}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700">
          1h: {arrow(d.bias)} {d.bias}
        </span>
      </div>

      {/* Barra de confianza */}
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

      {/* Niveles clave */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">Precio</div>
          <div className="font-semibold tabular-nums">{money(data.last)}</div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">Objetivo inmediato</div>
          <div className="font-semibold tabular-nums">{money(objetivo)}</div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">Invalidación</div>
          <div className="font-semibold tabular-nums">
            {money(invalidacion)}
          </div>
        </div>
      </div>

      {/* Qué observar (1 línea) */}
      <div className="text-sm text-neutral-300">{queObservar}</div>

      {/* Razones (compacto) */}
      {!!v.reasons.length && (
        <ul className="text-xs text-neutral-400 list-disc pl-5 space-y-1">
          {v.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="text-xs text-neutral-500">
        *Heurística educativa basada en medias, % de cambio y rango de 24h. No
        es recomendación financiera.
      </div>
    </section>
  );
}
