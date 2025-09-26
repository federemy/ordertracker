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
  shortTerm: SummaryBlock; // 24–72h
  mediumTerm: SummaryBlock; // 1–2 semanas
  sampleHeadlines: { title: string; source: string }[];
};

export default function NewsSentimentSummary({
  asset = "ETH",
  orderSide: _orderSide, // opcional: ajusta el copy
  refreshKey,
}: {
  asset?: string;
  orderSide?: "BUY" | "SELL";
  refreshKey?: number | string;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ====== Helpers de estilo / formato ======
  const verdictColor = (v?: Verdict) =>
    v === "Alcista"
      ? "text-emerald-400"
      : v === "Bajista"
      ? "text-rose-400"
      : "text-yellow-300";

  const verdictBg = (v?: Verdict) =>
    v === "Alcista"
      ? "bg-emerald-500/15 border-emerald-700/40"
      : v === "Bajista"
      ? "bg-rose-500/15 border-rose-700/40"
      : "bg-yellow-500/15 border-yellow-700/40";

  const dotBgFromText = (txt: string) => {
    const s = txt.toLowerCase();
    if (s.includes("alcista")) return "bg-emerald-400";
    if (s.includes("bajista")) return "bg-rose-400";
    if (s.includes("neutro") || s.includes("lateral") || s.includes("mixto"))
      return "bg-yellow-300";
    return "bg-neutral-500";
  };

  const clamp01 = (n: number) => Math.max(0, Math.min(100, n || 0));

  const fmtTime = (ms?: number) =>
    ms ? new Date(ms).toLocaleTimeString() : "—";

  // Copy según BUY/SELL (usado en summaries)
  const tilt = useMemo(() => {
    if (_orderSide === "BUY") return "Para compras: ";
    if (_orderSide === "SELL") return "Para ventas: ";
    return "";
  }, [_orderSide]);

  // ====== Fetch ======
  const refetch = async () => {
    try {
      setLoading(true);
      setErr(null);
      const r = await fetch("/.netlify/functions/news-aggregator", {
        headers: { "cache-control": "no-cache" },
      });
      if (!r.ok) throw new Error(`news ${r.status}`);
      const j = (await r.json()) as ApiResponse;
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Error de red/APIs");
    } finally {
      setLoading(false);
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ====== UI ======
  const Block = ({ title, block }: { title: string; block: SummaryBlock }) => {
    const conf = clamp01(block.confidence);
    return (
      <div className="grid gap-2 p-3 rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">{title}</div>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${verdictBg(
              block.verdict
            )} ${verdictColor(block.verdict)}`}
            title={`Veredicto: ${block.verdict}`}
          >
            {block.verdict}
          </span>
          <div
            className="ml-auto w-full sm:w-56 h-2 rounded bg-neutral-800 overflow-hidden"
            title={`Confianza ${conf}%`}
            aria-label={`Confianza ${conf}%`}
          >
            <div
              className={`h-full ${
                block.verdict === "Alcista"
                  ? "bg-emerald-500"
                  : block.verdict === "Bajista"
                  ? "bg-rose-500"
                  : "bg-yellow-400"
              }`}
              style={{ width: `${conf}%` }}
            />
          </div>
          <span className="text-xs text-neutral-300">{conf}%</span>
        </div>

        <p className="text-sm text-neutral-200">
          {tilt}
          {block.summary}
        </p>

        {!!block.reasons?.length && (
          <ul className="text-sm space-y-1">
            {block.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`mt-1 inline-block w-2 h-2 rounded-full ${dotBgFromText(
                    r
                  )}`}
                />
                <span className="text-neutral-300">{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  if (err) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-2">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">
            Mercado — Sentimiento por noticias
          </div>
          <button
            onClick={refetch}
            className="px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/20"
          >
            Reintentar
          </button>
        </div>
        <div className="text-sm text-rose-400">Error: {String(err)}</div>
      </section>
    );
  }

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          Mercado — Sentimiento por noticias · {asset.toUpperCase()}
        </div>
        {loading ? (
          <div className="hidden md:block text-xs text-neutral-400">
            Actualizando…
          </div>
        ) : data ? (
          <div className="text-xs text-neutral-400">
            Actualizado: {fmtTime(data.updatedAt)}
          </div>
        ) : null}
      </div>

      {!data ? (
        // Skeleton simple
        <div className="grid gap-2">
          <div className="h-24 rounded-xl bg-neutral-800/40 animate-pulse" />
          <div className="h-24 rounded-xl bg-neutral-800/40 animate-pulse" />
        </div>
      ) : (
        <>
          {/* Corto plazo */}
          <Block title="Corto plazo (24–72h)" block={data.shortTerm} />

          {/* Mediano plazo */}
          <Block title="Mediano plazo (1–2 semanas)" block={data.mediumTerm} />

          {/* Titulares de muestra */}
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

          {/* Frase final de lectura rápida */}
          <div className="mt-1 text-sm text-neutral-300">
            Lectura rápida: en <b>24–72h</b> el tono es{" "}
            <b className={verdictColor(data.shortTerm.verdict)}>
              {data.shortTerm.verdict.toLowerCase()}
            </b>{" "}
            ({data.shortTerm.confidence}
            %), y a <b>1–2 semanas</b> se mantiene{" "}
            <b className={verdictColor(data.mediumTerm.verdict)}>
              {data.mediumTerm.verdict.toLowerCase()}
            </b>{" "}
            ({data.mediumTerm.confidence}
            %). Esto aplica como contexto general para {asset.toUpperCase()}.
          </div>
        </>
      )}
    </section>
  );
}
