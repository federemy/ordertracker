import { useEffect, useMemo, useState } from "react";

type Verdict = "Alcista" | "Bajista" | "Mixto/Neutro";

type ApiResponse = {
  updatedAt: number;
  shortTerm: { verdict: Verdict; confidence: number; reasons: string[] };
  mediumTerm: { verdict: Verdict; confidence: number; reasons: string[] };
  sampleHeadlines: { title: string; source: string }[];
};

function sentenceFor(
  label: string,
  v: Verdict,
  conf: number,
  bias: "BUY" | "SELL" | undefined
) {
  const confLbl = conf >= 70 ? "alta" : conf >= 45 ? "media" : "baja";
  const dir =
    v === "Alcista" ? "alcista" : v === "Bajista" ? "bajista" : "neutra/mixta";

  // Ajuste sutil según sesgo operativo actual (opcional)
  const hint =
    bias === "BUY" && v === "Bajista"
      ? " • Precaución si pensás comprar."
      : bias === "SELL" && v === "Alcista"
      ? " • Precaución si pensás vender."
      : "";

  return `${label}: lectura ${dir} (confianza ${conf}%, ${confLbl}).${hint}`;
}

export default function NewsSentimentSummary({
  asset = "ETH",
  orderSide, // "BUY" | "SELL" (opcional, para matiz de frase)
  refreshKey,
}: {
  asset?: string;
  orderSide?: "BUY" | "SELL";
  refreshKey?: number | string;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const title = useMemo(
    () => `${asset.toUpperCase()} — Sentimiento por noticias (corto / mediano)`,
    [asset]
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const r = await fetch("/.netlify/functions/news-aggregator");
        if (!r.ok) throw new Error(`news-aggregator ${r.status}`);
        const j: ApiResponse = await r.json();
        if (!cancel) setData(j);
      } catch (e: any) {
        if (!cancel) setErr(e?.message || "Error obteniendo noticias.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [refreshKey]);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 grid gap-2">
      <div className="text-lg font-semibold">{title}</div>
      {loading && (
        <div className="text-sm text-neutral-400">Leyendo titulares…</div>
      )}
      {err && <div className="text-sm text-rose-400">Error: {err}</div>}

      {data && (
        <>
          <p className="text-sm text-neutral-200">
            {sentenceFor(
              "Corto plazo (1–3 días)",
              data.shortTerm.verdict,
              data.shortTerm.confidence,
              orderSide
            )}
          </p>
          <p className="text-sm text-neutral-200">
            {sentenceFor(
              "Mediano plazo (1–2 semanas)",
              data.mediumTerm.verdict,
              data.mediumTerm.confidence,
              orderSide
            )}
          </p>

          {/* Razones compactas (opcionales) */}
          {(data.shortTerm.reasons.length > 0 ||
            data.mediumTerm.reasons.length > 0) && (
            <ul className="mt-1 text-xs text-neutral-400 list-disc pl-4 space-y-1">
              {data.shortTerm.reasons.slice(0, 2).map((r, i) => (
                <li key={`s-${i}`}>{r}</li>
              ))}
              {data.mediumTerm.reasons.slice(0, 2).map((r, i) => (
                <li key={`m-${i}`}>{r}</li>
              ))}
            </ul>
          )}

          {/* Muestra 2 titulares representativos (sin links para evitar tracking) */}
          {data.sampleHeadlines?.length > 0 && (
            <div className="text-xs text-neutral-500">
              Ejemplos recientes: “{data.sampleHeadlines[0]?.title}” (
              {data.sampleHeadlines[0]?.source})
              {data.sampleHeadlines[1]
                ? ` · “${data.sampleHeadlines[1]?.title}” (${data.sampleHeadlines[1]?.source})`
                : ""}
            </div>
          )}
        </>
      )}
    </section>
  );
}
