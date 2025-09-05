import type { EthAnalysis } from "./EthIntraday";

type Verdict =
  | { dir: "sube"; confidence: number; reasons: string[] }
  | { dir: "baja"; confidence: number; reasons: string[] }
  | { dir: "lateral"; confidence: number; reasons: string[] };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function getEthVerdict(data: EthAnalysis): Verdict {
  // señales base: corto (5m ~3h) y día (1h 24h)
  const s = data.short;
  const d = data.day;

  let score = 0;
  const reasons: string[] = [];

  // 1) Sesgo por medias
  if (s.bias === "Alcista") {
    score += 2;
    reasons.push("Intradía: SMA rápida > lenta");
  }
  if (s.bias === "Bajista") {
    score -= 2;
    reasons.push("Intradía: SMA rápida < lenta");
  }

  if (d.bias === "Alcista") {
    score += 2;
    reasons.push("1 día: SMA(6) > SMA(24)");
  }
  if (d.bias === "Bajista") {
    score -= 2;
    reasons.push("1 día: SMA(6) < SMA(24)");
  }

  // 2) Momento (variación dentro de cada ventana)
  if (s.pct > 0.3) {
    score += 1;
    reasons.push(`Intradía +${s.pct.toFixed(2)}%`);
  }
  if (s.pct < -0.3) {
    score -= 1;
    reasons.push(`Intradía ${s.pct.toFixed(2)}%`);
  }

  if (d.pct > 0.5) {
    score += 1;
    reasons.push(`1 día +${d.pct.toFixed(2)}%`);
  }
  if (d.pct < -0.5) {
    score -= 1;
    reasons.push(`1 día ${d.pct.toFixed(2)}%`);
  }

  // 3) Estructura (precio vs medias en intradía)
  if (s.smaFast != null && s.smaSlow != null) {
    if (data.last > s.smaFast && s.smaFast > s.smaSlow) {
      score += 1;
      reasons.push("Precio > SMA rápida > SMA lenta");
    } else if (data.last < s.smaFast && s.smaFast < s.smaSlow) {
      score -= 1;
      reasons.push("Precio < SMA rápida < SMA lenta");
    }
  }

  // 4) Posición en rango diario (compras en piso / ventas en techo)
  if (d.max > d.min) {
    const pos = (data.last - d.min) / (d.max - d.min); // 0 = piso, 1 = techo
    if (pos < 0.2 && (s.bias === "Alcista" || d.bias === "Alcista")) {
      score += 1;
      reasons.push("Cerca del piso diario con sesgo alcista");
    } else if (pos > 0.8 && (s.bias === "Bajista" || d.bias === "Bajista")) {
      score -= 1;
      reasons.push("Cerca del techo diario con sesgo bajista");
    }
  }

  // Normalizar
  score = clamp(score, -6, 6);
  const confidence = Math.round((Math.abs(score) / 6) * 100);

  if (score >= 2) return { dir: "sube", confidence, reasons };
  if (score <= -2) return { dir: "baja", confidence, reasons };
  return { dir: "lateral", confidence, reasons };
}

export default function EthVerdict({ data }: { data?: EthAnalysis | null }) {
  if (!data) return null;
  const v = getEthVerdict(data);

  const badge = (txt: string, cls: string) => (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}
    >
      {txt}
    </span>
  );

  const cls =
    v.dir === "sube"
      ? "bg-emerald-600/15 text-emerald-300 border-emerald-700/40"
      : v.dir === "baja"
      ? "bg-rose-600/15 text-rose-300 border-rose-700/40"
      : "bg-neutral-800 text-neutral-200 border-neutral-700";

  const headline =
    v.dir === "sube"
      ? "Probable continuación al alza a corto plazo."
      : v.dir === "baja"
      ? "Probable continuidad bajista a corto plazo."
      : "Movimiento lateral / indefinido en este momento.";

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">ETH — Veredicto</div>
        {badge(`${v.confidence}% confianza`, cls)}
      </div>

      <div className="text-base">
        {v.dir === "sube" && (
          <>
            Según las señales, <b>va a subir</b> (sesgo alcista). {headline}
          </>
        )}
        {v.dir === "baja" && (
          <>
            Según las señales, <b>va a seguir bajando</b> (sesgo bajista).{" "}
            {headline}
          </>
        )}
        {v.dir === "lateral" && (
          <>
            Según las señales, <b>no hay dirección clara</b>. {headline}
          </>
        )}
      </div>

      {!!v.reasons.length && (
        <ul className="text-sm text-neutral-300 list-disc pl-5 space-y-1">
          {v.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="text-xs text-neutral-500">
        *Heurística educativa basada en medias móviles, % de cambio y rango. No
        es recomendación financiera.
      </div>
    </section>
  );
}
