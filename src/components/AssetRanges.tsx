import { useEffect, useMemo, useState } from "react";

// Muestra ATH, min/max 1/3/6/12 meses y posición del precio actual.
// Necesita el proxy: /.netlify/functions/binance-proxy
type Props = {
  asset: string; // "ETH", "BTC", etc.
  price?: number | null; // precio actual (USDT)
};

type Kline = [
  number, // openTime
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime
  string, // quoteAssetVolume
  number, // numberOfTrades
  string, // takerBuyBaseAssetVolume
  string, // takerBuyQuoteAssetVolume
  string // ignore
];

function fmt(n: number | null | undefined, maxFrac = 2) {
  if (n == null || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: maxFrac,
  }).format(n);
}

function pctPos(min: number, max: number, v: number) {
  if (!isFinite(min) || !isFinite(max) || max <= min) return null;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

function verdictOneLiner(
  pos12m: number | null,
  ath: number | null,
  price?: number | null
) {
  if (pos12m == null || ath == null || price == null)
    return "Sin señal suficiente.";
  const fromAth = price / ath - 1; // negativo si bajo ATH
  // Heurística simple:
  if (pos12m < 0.2 && fromAth <= -0.4)
    return "Precio cerca de piso anual y lejos del ATH: podría estar en zona de acumulación (riesgo medio/bajo).";
  if (pos12m > 0.8 && fromAth >= -0.1)
    return "Precio cerca de techo anual y relativamente próximo al ATH: riesgo de toma de ganancias elevado.";
  if (pos12m >= 0.4 && pos12m <= 0.6)
    return "Precio en la mitad del rango anual: escenario neutral/lateral.";
  if (pos12m < 0.4)
    return "Precio en la banda inferior del rango anual: sesgo favorable si se sostiene.";
  return "Precio en la banda superior del rango anual: sesgo prudente si no rompe con volumen.";
}

export default function AssetRanges({ asset, price }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [klines, setKlines] = useState<Kline[]>([]);

  // Descarga hasta ~2000 días (dos páginas) de velas 1D
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        setLoading(true);
        setErr(null);

        const symbol = `${asset.toUpperCase()}USDT`;
        const page = async (endTime?: number) => {
          const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=1d&limit=1000${
            endTime ? `&endTime=${endTime}` : ""
          }`;
          const r = await fetch(url, {
            headers: { "cache-control": "no-cache" },
          });
          if (!r.ok) throw new Error(`binance-proxy ${r.status}`);
          const j = (await r.json()) as Kline[];
          return j;
        };

        const p1 = await page();
        let all = p1;
        if (p1.length === 1000) {
          const oldestCloseTime = p1[0][0]; // openTime del primero
          const p2 = await page(oldestCloseTime - 1);
          all = [...p2, ...p1];
        }

        if (!cancelled) setKlines(all);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Error al cargar velas");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [asset]);

  const summary = useMemo(() => {
    if (!klines?.length) return null;
    const closes = klines.map((k) => Number(k[4])).filter(Number.isFinite);
    const highs = klines.map((k) => Number(k[2])).filter(Number.isFinite);
    const lows = klines.map((k) => Number(k[3])).filter(Number.isFinite);

    const last = closes.at(-1) ?? null;

    // Ventanas
    const sliceN = (n: number) => closes.slice(-n);
    const win = (n: number) => {
      const s = sliceN(n);
      if (!s.length) return null;
      return { min: Math.min(...s), max: Math.max(...s) };
    };

    const w30 = win(30);
    const w90 = win(90);
    const w180 = win(180);
    const w365 = win(365);

    // ATH/ATL aproximados dentro de lo descargado
    const ath = highs.length ? Math.max(...highs) : null;
    const atl = lows.length ? Math.min(...lows) : null;

    // Posiciones del precio actual en cada rango
    const p = price ?? last ?? null;
    const pos30 = w30 && p != null ? pctPos(w30.min, w30.max, p) : null;
    const pos90 = w90 && p != null ? pctPos(w90.min, w90.max, p) : null;
    const pos180 = w180 && p != null ? pctPos(w180.min, w180.max, p) : null;
    const pos365 = w365 && p != null ? pctPos(w365.min, w365.max, p) : null;

    const line = verdictOneLiner(pos365, ath, p);

    return {
      last: p,
      ath,
      atl,
      w30,
      w90,
      w180,
      w365,
      pos30,
      pos90,
      pos180,
      pos365,
      verdict: line,
    };
  }, [klines, price]);

  if (loading && !summary) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
        <div className="animate-pulse text-sm text-neutral-400">
          Cargando rangos de {asset}…
        </div>
      </section>
    );
  }
  if (err) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
        <div className="text-sm text-rose-400">
          No pude cargar datos de {asset}: {err}
        </div>
      </section>
    );
  }
  if (!summary) return null;

  const bar = (pos: number | null) => (
    <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-sky-500"
        style={{
          width: `${(pos ?? 0) * 100}%`,
          transition: "width 300ms ease",
        }}
      />
    </div>
  );

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="text-lg font-semibold">{asset} — Rangos y ATH</div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">Precio actual</div>
          <div className="font-semibold tabular-nums">{fmt(summary.last)}</div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">ATH (aprox.)</div>
          <div className="font-semibold tabular-nums">{fmt(summary.ath)}</div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">ATL (aprox.)</div>
          <div className="font-semibold tabular-nums">{fmt(summary.atl)}</div>
        </div>
      </div>

      {/* 1 mes */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>1 mes</span>
          <span>
            {fmt(summary.w30?.min)} – {fmt(summary.w30?.max)}
          </span>
        </div>
        {bar(summary.pos30)}
      </div>

      {/* 3 meses */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>3 meses</span>
          <span>
            {fmt(summary.w90?.min)} – {fmt(summary.w90?.max)}
          </span>
        </div>
        {bar(summary.pos90)}
      </div>

      {/* 6 meses */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>6 meses</span>
          <span>
            {fmt(summary.w180?.min)} – {fmt(summary.w180?.max)}
          </span>
        </div>
        {bar(summary.pos180)}
      </div>

      {/* 1 año */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>1 año</span>
          <span>
            {fmt(summary.w365?.min)} – {fmt(summary.w365?.max)}
          </span>
        </div>
        {bar(summary.pos365)}
      </div>

      {/* veredicto corto */}
      <div className="text-sm text-neutral-200">{summary.verdict}</div>

      <div className="text-xs text-neutral-500">
        *Datos 1D aproximados vía Binance (proxy). Material educativo, no es
        recomendación financiera.
      </div>
    </section>
  );
}
