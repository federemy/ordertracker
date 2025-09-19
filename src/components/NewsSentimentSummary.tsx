// src/components/NewsSentimentSummary.tsx
import { useEffect, useMemo, useState } from "react";

type Verdict = "Alcista" | "Bajista" | "Mixto/Neutro";

type SummaryBlock = {
  verdict: Verdict;
  confidence: number; // 0-100
  reasons: string[];
  summary: string;
};

type ApiResponse = {
  updatedAt: number;
  shortTerm: SummaryBlock;
  mediumTerm: SummaryBlock;
  sampleHeadlines: { title: string; source: string }[];
};

export default function NewsSentimentSummary({
  asset = "ETH",
  orderSide: _orderSide, // lo usamos para ajustar el copy
  refreshKey,
}: {
  asset?: string;
  orderSide?: "BUY" | "SELL";
  refreshKey?: number | string;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pequeño prefijo de copy según BUY/SELL (lo usa el texto, evita var sin usar)
  const tilt = useMemo(() => {
    if (_orderSide === "BUY") return "Para compras: ";
    if (_orderSide === "SELL") return "Para ventas: ";
    return "";
  }, [_orderSide]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const r = await fetch("/.netlify/functions/news-aggregator", {
          headers: { "cache-control": "no-cache" },
        });
        if (!r.ok) throw new Error(`news ${r.status}`);
        const j = (await r.json()) as ApiResponse;
        if (!cancelled) setData(j);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Error de red/APIs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const fmtTime = (ms?: number) =>
    ms ? new Date(ms).toLocaleTimeString() : "—";

  if (err) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
        <div className="text-lg font-semibold">
          Mercado — Sentimiento por noticias
        </div>
        <div className="mt-2 text-sm text-rose-400">Error: {String(err)}</div>
      </section>
    );
  }

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          Mercado — Sentimiento por noticias
        </div>
        {loading ? (
          <div className="hidden md:block text-xs text-neutral-400">
            Actualizando…
          </div>
        ) : (
          data && (
            <div className="text-xs text-neutral-400">
              Actualizado: {fmtTime(data.updatedAt)}
            </div>
          )
        )}
      </div>

      {!data ? (
        <div className="text-sm text-neutral-400">Cargando…</div>
      ) : (
        <>
          {/* Bloque corto plazo */}
          <div className="grid gap-1 p-3 rounded-xl border border-neutral-800 bg-neutral-900/50">
            <div className="text-sm font-medium">
              Corto plazo (24–72h): {data.shortTerm.verdict} ·{" "}
              <span className="text-neutral-300">
                {data.shortTerm.confidence}% confianza
              </span>
            </div>
            <p className="text-sm text-neutral-200">
              {tilt}
              {data.shortTerm.summary}
            </p>
            {!!data.shortTerm.reasons?.length && (
              <ul className="text-xs text-neutral-400 list-disc pl-5 space-y-0.5">
                {data.shortTerm.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Bloque mediano plazo */}
          <div className="grid gap-1 p-3 rounded-xl border border-neutral-800 bg-neutral-900/50">
            <div className="text-sm font-medium">
              Mediano plazo (1–2 semanas): {data.mediumTerm.verdict} ·{" "}
              <span className="text-neutral-300">
                {data.mediumTerm.confidence}% confianza
              </span>
            </div>
            <p className="text-sm text-neutral-200">
              {tilt}
              {data.mediumTerm.summary}
            </p>
            {!!data.mediumTerm.reasons?.length && (
              <ul className="text-xs text-neutral-400 list-disc pl-5 space-y-0.5">
                {data.mediumTerm.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Muestra 2–3 titulares (opcional) */}
          {!!data.sampleHeadlines?.length && (
            <div className="grid gap-1">
              <div className="text-xs text-neutral-400">
                Titulares muestreados
              </div>
              <ul className="text-sm text-neutral-200 space-y-1">
                {data.sampleHeadlines.slice(0, 3).map((h, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500" />
                    <span className="font-medium">{h.title}</span>
                    <span className="text-neutral-400 text-xs">
                      · {h.source}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Frase final (resumen) */}
          <div className="mt-1 text-sm text-neutral-300">
            Lectura rápida: en <b>24–72h</b> el tono es{" "}
            <b>{data.shortTerm.verdict.toLowerCase()}</b> (
            {data.shortTerm.confidence}
            %), y a <b>1–2 semanas</b> se mantiene{" "}
            <b>{data.mediumTerm.verdict.toLowerCase()}</b> (
            {data.mediumTerm.confidence}
            %). Esto aplica como contexto general para {asset.toUpperCase()}.
          </div>
        </>
      )}
    </section>
  );
}
