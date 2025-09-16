import { useEffect, useMemo, useState } from "react";

type OrderSide = "BUY" | "SELL";

type PeriodKey = "7d" | "15d" | "1m" | "3m" | "6m" | "1a";

type PeriodDef = {
  key: PeriodKey;
  label: string;
  limitDays: number; // cuántas velas 1d pedimos
};

const PERIODS: PeriodDef[] = [
  { key: "7d", label: "7 días", limitDays: 7 },
  { key: "15d", label: "15 días", limitDays: 15 },
  { key: "1m", label: "1 mes", limitDays: 30 },
  { key: "3m", label: "3 meses", limitDays: 90 },
  { key: "6m", label: "6 meses", limitDays: 180 },
  { key: "1a", label: "1 año", limitDays: 365 },
];

type RangeRow = {
  key: PeriodKey;
  label: string;
  min: number;
  max: number;
  pos: number; // 0..1 dónde cae el precio actual
  cheap: number; // 0..1 barra "barato"
  fair: number; // 0..1 barra "medio"
  exp: number; // 0..1 barra "caro"
  nearAth: boolean; // cerca del techo
  nearAtl: boolean; // cerca del piso
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

async function fetchDailyKlines(symbol: string, limit: number) {
  // Usamos proxy Netlify para evitar CORS/bloqueos regionales
  const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=1d&limit=${limit}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`proxy ${r.status}`);
  return (await r.json()) as any[];
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function computeRow(
  key: PeriodKey,
  label: string,
  price: number,
  highs: number[],
  lows: number[],
  nearPct = 0.02
): RangeRow {
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = Math.max(0, max - min);
  const pos = span > 0 ? (price - min) / span : 0.5;

  // zonas (tercios iguales)
  const cheap = 1 / 3;
  const fair = 1 / 3;
  const exp = 1 / 3;

  const nearAth = span > 0 && (max - price) / max <= nearPct;
  const nearAtl = span > 0 && (price - min) / min <= nearPct;

  return {
    key,
    label,
    min,
    max,
    pos: clamp01(pos),
    cheap,
    fair,
    exp,
    nearAth,
    nearAtl,
  };
}

export default function AssetRanges({
  asset = "ETH",
  price,
  refreshKey, // cambia cada 10 min
  orderType, // "BUY" | "SELL" (opcional)
  nearPct = 0.02, // 2% cerca del ATH/ATL
}: {
  asset?: string;
  price?: number;
  refreshKey?: number | string;
  orderType?: OrderSide;
  nearPct?: number;
}) {
  const symbol = useMemo(
    () => `${(asset || "ETH").toUpperCase()}USDT`,
    [asset]
  );

  const [rows, setRows] = useState<RangeRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // mobile: colapsado por defecto (mostrar hasta 1m)
  const [mobileExpanded, setMobileExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        if (!price || !Number.isFinite(price)) return;
        setLoading(true);
        setErr(null);

        // Pedimos UNA sola vez el máximo required (365) y derivamos las ventanas
        const maxLimit = Math.max(...PERIODS.map((p) => p.limitDays));
        const data = await fetchDailyKlines(symbol, maxLimit);

        // data[i] => [openTime, open, high, low, close, ...]
        const highsAll = data
          .map((k: any) => Number(k[2]))
          .filter(Number.isFinite);
        const lowsAll = data
          .map((k: any) => Number(k[3]))
          .filter(Number.isFinite);

        const out: RangeRow[] = PERIODS.map((p) => {
          const highs = highsAll.slice(-p.limitDays);
          const lows = lowsAll.slice(-p.limitDays);
          return computeRow(p.key, p.label, price, highs, lows, nearPct);
        });

        if (!cancelled) setRows(out);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Error de red/APIs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, price, refreshKey]);

  if (!price) return null;

  const headerBadge = (r: RangeRow) => {
    // Heurística de color guía según orderType
    // - BUY: cerca del ATL => verde (barato); cerca del ATH => rojo (caro)
    // - SELL: cerca del ATH => verde (bueno para vender); cerca del ATL => rojo
    let badge = {
      text: "",
      cls: "bg-neutral-800 border-neutral-700 text-neutral-300",
    };

    if (orderType === "BUY") {
      if (r.nearAtl)
        badge = {
          text: "barato",
          cls: "bg-emerald-600/20 border-emerald-600/40 text-emerald-300",
        };
      else if (r.nearAth)
        badge = {
          text: "caro",
          cls: "bg-rose-600/20 border-rose-600/40 text-rose-300",
        };
    }
    if (orderType === "SELL") {
      if (r.nearAth)
        badge = {
          text: "oportuno vender",
          cls: "bg-emerald-600/20 border-emerald-600/40 text-emerald-300",
        };
      else if (r.nearAtl)
        badge = {
          text: "desfavorable",
          cls: "bg-rose-600/20 border-rose-600/40 text-rose-300",
        };
    }

    return (
      <span
        className={`px-2 py-0.5 text-[11px] rounded-full border ${badge.cls}`}
      >
        {badge.text || "—"}
      </span>
    );
  };

  const Bar = ({ r }: { r: RangeRow }) => {
    const markerLeft = `${r.pos * 100}%`;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="font-medium">{r.label}</div>
          {headerBadge(r)}
        </div>

        {/* Barra 3 zonas */}
        <div className="relative h-3 w-full rounded-full overflow-hidden border border-neutral-800">
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: `${r.cheap * 100}%` }}
          />
          <div
            className="absolute inset-y-0"
            style={{ left: `${r.cheap * 100}%`, width: `${r.fair * 100}%` }}
          />
          <div
            className="absolute inset-y-0 right-0"
            style={{ width: `${r.exp * 100}%` }}
          />

          {/* Colores con utilidades */}
          <div
            className="absolute inset-y-0 left-0 bg-emerald-700/30"
            style={{ width: "33.3333%" }}
          />
          <div
            className="absolute inset-y-0 left-1/3 bg-neutral-500/30"
            style={{ width: "33.3333%" }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-rose-700/30"
            style={{ width: "33.3333%" }}
          />

          {/* Marcador de precio actual */}
          <div
            className="absolute -top-1 bottom-0 w-0.5 bg-white/90"
            style={{ left: markerLeft }}
            aria-hidden
          />
        </div>

        {/* Etiquetas (min / precio / max) */}
        <div className="flex items-center justify-between text-[11px] text-neutral-400 tabular-nums">
          <span>ATL {fmtMoney(r.min)}</span>
          <span className="text-neutral-300">Precio {fmtMoney(price)}</span>
          <span>ATH {fmtMoney(r.max)}</span>
        </div>

        {/* Mini leyenda barato/medio/caro */}
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
        </div>
      </div>
    );
  };

  // === Mini-VEREDICTO ATH/ATL ===
  function verdictFromRange(r?: RangeRow, side?: OrderSide) {
    if (!r) return { text: "—", cls: "text-neutral-300" };

    const posPct = Math.round(r.pos * 100); // 0..100
    const distAthPct =
      r.max > 0 ? Math.max(0, ((r.max - (price || 0)) / r.max) * 100) : 0;
    const distAtlPct =
      r.min > 0 ? Math.max(0, (((price || 0) - r.min) / r.min) * 100) : 0;

    // bucket por tercios
    const zone = r.pos <= 1 / 3 ? "barato" : r.pos >= 2 / 3 ? "caro" : "medio";

    // mensaje base por BUY/SELL
    let headline = "";
    let cls = "text-neutral-300";
    if (side === "BUY") {
      if (zone === "barato") {
        headline = "Precio en zona barata. Favorable para comprar.";
        cls = "text-emerald-300";
      } else if (zone === "caro") {
        headline = "Precio en zona cara. Riesgo de compra elevado.";
        cls = "text-rose-300";
      } else {
        headline = "Precio en zona media. Señal neutral para compra.";
      }
    } else if (side === "SELL") {
      if (zone === "caro") {
        headline = "Precio en zona alta. Favorable para vender.";
        cls = "text-emerald-300";
      } else if (zone === "barato") {
        headline = "Precio en zona baja. Desfavorable para vender.";
        cls = "text-rose-300";
      } else {
        headline = "Precio en zona media. Señal neutral para venta.";
      }
    } else {
      // sin orden definida
      if (zone === "barato") {
        headline = "En tercio inferior del rango (barato).";
        cls = "text-emerald-300";
      } else if (zone === "caro") {
        headline = "En tercio superior del rango (caro).";
        cls = "text-rose-300";
      } else {
        headline = "En el rango medio.";
      }
    }

    const extra = `Posición: ${posPct}% del rango · a ${distAtlPct.toFixed(
      1
    )}% del ATL y ${distAthPct.toFixed(1)}% del ATH.`;

    return { text: `${headline} ${extra}`, cls };
  }

  // tomo 1m como período "principal" para el veredicto; si falta, fallback
  const pickVerdictRow = (rs?: RangeRow[] | null) => {
    if (!rs || rs.length === 0) return undefined;
    return (
      rs.find((r) => r.key === "1m") ||
      rs.find((r) => r.key === "3m") ||
      rs.find((r) => r.key === "1a") ||
      rs[0]
    );
  };

  const visibleMobileKeys: PeriodKey[] = ["7d", "15d", "1m"];
  const mobileHidden = useMemo(() => {
    if (!rows) return [] as RangeRow[];
    return rows.filter((r) => !visibleMobileKeys.includes(r.key));
  }, [rows]);

  const verdictRow = pickVerdictRow(rows);
  const verdict = verdictFromRange(verdictRow, orderType);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">
          {asset.toUpperCase()} — ATH / ATL por período
        </div>
        {loading && (
          <div className="hidden md:block text-xs text-neutral-400">
            Actualizando…
          </div>
        )}
      </div>

      {err && <div className="text-sm text-rose-400">Error: {String(err)}</div>}

      {!rows && !err && (
        <div className="text-sm text-neutral-400">Cargando…</div>
      )}

      {!!rows && (
        <>
          {/* mobile: solo 7d/15d/1m si no está expandido */}
          <div className="grid gap-4">
            {(rows || []).map((r) => {
              const isHiddenOnMobile =
                !mobileExpanded && !visibleMobileKeys.includes(r.key);
              return (
                <div
                  key={r.key}
                  className={`${
                    isHiddenOnMobile ? "hidden md:block" : "block"
                  }`}
                >
                  <Bar r={r} />
                </div>
              );
            })}
          </div>

          {/* Botón ver más / ver menos SOLO en mobile */}
          <div className="md:hidden">
            {mobileHidden.length > 0 && (
              <button
                onClick={() => setMobileExpanded((v) => !v)}
                className="mt-1 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm"
              >
                {mobileExpanded ? "Ver menos" : "Ver más"}
              </button>
            )}
          </div>

          {/* Mini-veredicto ATH/ATL */}
          <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 text-sm">
            <div className="flex items-center justify-between gap-2">
              <b>Veredicto ATH/ATL</b>
              <span className="text-xs text-neutral-400">
                Base: {verdictRow?.label || "—"}
              </span>
            </div>
            <div className={`mt-1 ${verdict.cls}`}>{verdict.text}</div>
            <div className="mt-2 text-[11px] text-neutral-500">
              *Heurística educativa basada en posición relativa dentro del rango
              (ATL↔ATH). No es recomendación financiera.
            </div>
          </div>
        </>
      )}
    </section>
  );
}
