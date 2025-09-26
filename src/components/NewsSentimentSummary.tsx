// src/components/NewsSentimentSummary.tsx
import { useEffect, useMemo, useState } from "react";

type Verdict = "Alcista" | "Bajista" | "Mixto/Neutro";

type SummaryBlock = {
  verdict: Verdict;
  confidence: number; // 0-100
  reasons: string[];
  summary: string;
};

type Headline = { title: string; source: string; ts?: number };

type ApiResponse = {
  updatedAt: number;
  shortTerm: SummaryBlock;   // 24–72h
  mediumTerm: SummaryBlock;  // 1–2 semanas
  sampleHeadlines: Headline[];
  // opcionales si el backend ya los expone
  ultraShortTerm?: SummaryBlock;      // última hora
  ultraHeadlines?: Headline[];        // titulares filtrados a 1h
};

export default function NewsSentimentSummary({
  asset = "ETH",
  orderSide: _orderSide,   // opcional: ajusta el copy
  refreshKey,
  ultraPollMs = 60_000,    // refresco del bloque "última hora"
}: {
  asset?: string;
  orderSide?: "BUY" | "SELL";
  refreshKey?: number | string;
  ultraPollMs?: number;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Estado específico de ULTRA CORTO PLAZO (última hora)
  const [ultra, setUltra] = useState<SummaryBlock | null>(null);
  const [ultraHeadlines, setUltraHeadlines] = useState<Headline[]>([]);
  const [ultraUpdatedAt, setUltraUpdatedAt] = useState<number | null>(null);
  const [loadingUltra, setLoadingUltra] = useState(false);
  const [errUltra, setErrUltra] = useState<string | null>(null);

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

  // ====== Fetch general (24–72h y 1–2 semanas) ======
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

  // ====== Fetch ULTRA (última hora) con auto-poll ======
  useEffect(() => {
    let cancelled = false;
    let timer: any;

    const fetchUltra = async () => {
      try {
        setLoadingUltra(true);
        setErrUltra(null);
        // Intento 1: el backend soporta ?window=1h y/o ?asset=ETH
        const u = await fetch(
          `/.netlify/functions/news-aggregator?window=1h&asset=${encodeURIComponent(
            asset
          )}`,
          { headers: { "cache-control": "no-cache" } }
        );
        if (!u.ok) throw new Error(`news ultra ${u.status}`);
        const ju = (await u.json()) as ApiResponse;

        // fallback si el backend aún no devuelve ultraShortTerm:
        const block =
          ju.ultraShortTerm ??
          ju.shortTerm ?? // usa la mejor disponible
          null;

        // titulares: preferí los ya filtrados a 1h; si no, filtrá por ts si viene
        const anHour = 60 * 60 * 1000;
        const heads =
          ju.ultraHeadlines ??
          (ju.sampleHeadlines || []).filter(
            (h) => !h.ts || Date.now() - (h.ts || 0) <= anHour
          );

        if (!cancelled) {
          setUltra(block);
          setUltraHeadlines(heads.slice(0, 5));
          setUltraUpdatedAt(ju.updatedAt ?? Date.now());
        }
      } catch (e: any) {
        if (!cancelled) setErrUltra(e?.message || "Error de red/APIs (1h)");
      } finally {
        if (!cancelled) setLoadingUltra(false);
      }
    };

    fetchUltra();
    timer = setInterval(fetchUltra, ultraPollMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [asset, refreshKey, ultraPollMs]);

  // ====== UI ======
  const ConfidenceBar = ({ v, c }: { v: Verdict; c: number }) => (
    <div
      className="ml-auto w-full sm:w-56 h-2 rounded bg-neutral-800 overflow-hidden"
      title={`Confianza ${c}%`}
      aria-label={`Confianza ${c}%`}
    >
      <div
        className={`h-full ${
          v === "Alcista"
            ? "bg-emerald-500"
            : v === "Bajista"
            ? "bg-rose-500"
            : "bg-yellow-400"
        }`}
        style={{ width: `${c}%` }}
      />
    </div>
  );

  const Block = ({
    title,
    block,
    showBadge = true,
  }: {
    title: string;
    block: SummaryBlock;
    showBadge?: boolean;
  }) => {
    const conf = clamp01(block.confidence);
    return (
      <div className="grid gap-2 p-3 rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">{title}</div>
          {showBadge && (
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${verdictBg(
                block.verdict
              )} ${verdictColor(block.verdict)}`}
              title={`Veredicto: ${block.verdict}`}
            >
              {block.verdict}
            </span>
          )}
          <ConfidenceBar v={block.verdict} c={conf} />
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

  const refetch = async () => {
    // botón reintentar en errores
    setErr(null);
    setErrUltra(null);
    // dispara ambos
    const stamp = Date.now();
    // “nudge” al key para invalidar caché externa si lo usás en el parent
    await Promise.allSettled([
      fetch("/.netlify/functions/news-aggregator?__nudge=" + stamp, {
        headers: { "cache-control": "no-cache" },
      }),
      fetch(
        `/.netlify/functions/news-aggregator?window=1h&asset=${encodeURIComponent(
          asset
        )}&__nudge=${stamp}`,
        { headers: { "cache-control": "no-cache" } }
      ),
    ]);
  };

  if (err) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-2">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">
            Mercado — Sentimiento por noticias · {asset.toUpperCase()}
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
        <div className="text-xs text-neutral-400 flex items-center gap-3">
          {loading ? "Actualizando…" : data ? `Actualizado: ${fmtTime(data.updatedAt)}` : null}
          {loadingUltra ? (
            <span className="hidden md:inline text-neutral-500">| 1h: actualizando…</span>
          ) : ultraUpdatedAt ? (
            <span className="hidden md:inline">| 1h: {fmtTime(ultraUpdatedAt)}</span>
          ) : null}
        </div>
      </div>

      {/* ===== ULTRA CORTO: última hora ===== */}
      {errUltra ? (
        <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-900/50">
          <div className="text-sm font-medium">
            ⚡ Ultra corto (última hora)
          </div>
          <div className="mt-1 text-sm text-yellow-300">
            No hay datos de última hora por ahora ({String(errUltra)}).
          </div>
        </div>
      ) : !ultra ? (
        <div className="h-20 rounded-xl bg-neutral-800/40 animate-pulse" />
      ) : (
        <>
          <Block
            title="⚡ Ultra corto (última hora)"
            block={ultra}
          />

          {!!ultraHeadlines.length && (
            <div className="grid gap-1">
              <div className="text-xs text-neutral-400">Titulares (última hora)</div>
              <ul className="text-sm text-neutral-200 space-y-1">
                {ultraHeadlines.slice(0, 5).map((h, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500" />
                    <span className="font-medium">{h.title}</span>
                    <span className="text-neutral-400 text-xs">· {h.source}</span>
                    {h.ts ? (
                      <span className="text-neutral-500 text-xs">
                        · {new Date(h.ts).toLocaleTimeString()}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ===== Bloques existentes (24–72h / 1–2 semanas) ===== */}
      {!data ? (
        <div className="grid gap-2">
          <div className="h-24 rounded-xl bg-neutral-800/40 animate-pulse" />
          <div className="h-24 rounded-xl bg-neutral-800/40 animate-pulse" />
        </div>
      ) : (
        <>
          <Block title="Corto plazo (24–72h)" block={data.shortTerm} />
          <Block title="Mediano plazo (1–2 semanas)" block={data.mediumTerm} />

          {!!data.sampleHeadlines?.length && (
            <div className="grid gap-1">
              <div className="text-xs text-neutral-400">Titulares muestreados</div>
              <ul className="text-sm text-neutral-200 space-y-1">
                {data.sampleHeadlines.slice(0, 3).map((h, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500" />
                    <span className="font-medium">{h.title}</span>
                    <span className="text-neutral-400 text-xs">· {h.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Frase final */}
          <div className="mt-1 text-sm text-neutral-300">
            Lectura rápida: en <b>1h</b> el tono es{" "}
            <b className={verdictColor(ultra?.verdict)}>{ultra?.verdict?.toLowerCase() ?? "—"}</b>
            {ultra ? ` (${clamp01(ultra.confidence)}%)` : ""}; en <b>24–72h</b> es{" "}
            <b className={verdictColor(data.shortTerm.verdict)}>
              {data.shortTerm.verdict.toLowerCase()}
            </b>{" "}
            ({data.shortTerm.confidence}%); y a <b>1–2 semanas</b> se mantiene{" "}
            <b className={verdictColor(data.mediumTerm.verdict)}>
              {data.mediumTerm.verdict.toLowerCase()}
            </b>{" "}
            ({data.mediumTerm.confidence}%). Esto aplica como contexto para {asset.toUpperCase()}.
          </div>
        </>
      )}
    </section>
  );
}
