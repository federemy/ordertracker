// src/components/AssetRanges.tsx
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  asset: string; // "ETH", "BTC", etc.
  price?: number | null; // precio actual (USDT)
  refreshKey?: number; // cambia cada 10 min desde Home para forzar fetch
};

type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

const TEN_MIN = 10 * 60 * 1000;

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
function oneLiner(pos: number | null, label: string) {
  if (pos == null) return `${label}: sin señal.`;
  if (pos < 0.2)
    return `${label}: zona baja del rango (potencial acumulación).`;
  if (pos > 0.8)
    return `${label}: zona alta del rango (riesgo de toma de ganancias).`;
  if (pos < 0.4)
    return `${label}: banda inferior; sesgo favorable si se sostiene.`;
  if (pos > 0.6)
    return `${label}: banda superior; prudencia si no rompe con volumen.`;
  return `${label}: mitad del rango; neutral.`;
}

function RangeBar({ pos }: { pos: number | null }) {
  return (
    <div className="w-full h-2 rounded-full overflow-hidden relative bg-neutral-800">
      {/* bandas 0-25-50-75-100 */}
      <div className="absolute inset-0 grid grid-cols-4">
        <div className="bg-white/5" />
        <div className="bg-white/10" />
        <div className="bg-white/5" />
        <div className="bg-white/10" />
      </div>
      <div
        className="relative h-full bg-sky-500"
        style={{
          width: `${(pos ?? 0) * 100}%`,
          transition: "width 300ms ease",
        }}
      />
    </div>
  );
}

export default function AssetRanges({ asset, price, refreshKey }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [klines, setKlines] = useState<Kline[]>([]);
  const lastFetchRef = useRef<number>(0);

  // Cache por asset
  const CACHE_KEY = `klines_1d_${asset.toUpperCase()}`;
  const useCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < TEN_MIN && Array.isArray(data)) {
        setKlines(data);
        lastFetchRef.current = ts;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Fetch velas 1D (hasta ~2000 días)
  const fetchAll = async () => {
    setLoading(true);
    setErr(null);
    try {
      const symbol = `${asset.toUpperCase()}USDT`;
      const page = async (endTime?: number) => {
        const url = `/.netlify/functions/binance-proxy?symbol=${symbol}&interval=1d&limit=1000${
          endTime ? `&endTime=${endTime}` : ""
        }`;
        const r = await fetch(url, {
          headers: { "cache-control": "no-cache" },
        });
        if (!r.ok) throw new Error(`binance-proxy ${r.status}`);
        return (await r.json()) as Kline[];
      };
      const p1 = await page();
      let all = p1;
      if (p1.length === 1000) {
        const oldestOpenTime = p1[0][0];
        const p2 = await page(oldestOpenTime - 1);
        all = [...p2, ...p1];
      }
      setKlines(all);
      lastFetchRef.current = Date.now();
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ts: lastFetchRef.current, data: all })
      );
    } catch (e: any) {
      setErr(e?.message || "Error al cargar velas");
    } finally {
      setLoading(false);
    }
  };

  // 1) Primer render: usar cache válida; si no hay, fetch
  useEffect(() => {
    if (!useCache()) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  // 2) Cuando cambia refreshKey (cada 10 min desde Home): si pasó TTL, refetch
  useEffect(() => {
    if (!refreshKey) return;
    if (Date.now() - (lastFetchRef.current || 0) >= TEN_MIN) {
      fetchAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const summary = useMemo(() => {
    if (!klines?.length) return null;
    const closes = klines.map((k) => Number(k[4])).filter(Number.isFinite);
    const highs = klines.map((k) => Number(k[2])).filter(Number.isFinite);
    const lows = klines.map((k) => Number(k[3])).filter(Number.isFinite);

    const lastClose = closes.at(-1) ?? null;
    const p = Number.isFinite(price ?? NaN) ? (price as number) : lastClose;

    // Helper para ventanas
    const win = (n: number) => {
      const s = closes.slice(-n);
      if (!s.length) return null;
      return { min: Math.min(...s), max: Math.max(...s) };
    };

    // NUEVO: 7d y 15d
    const w7 = win(7);
    const w15 = win(15);

    // Ventanas existentes
    const w30 = win(30);
    const w90 = win(90);
    const w180 = win(180);
    const w365 = win(365);

    // ATH/ATL en lo descargado
    const ath = highs.length ? Math.max(...highs) : null;
    const atl = lows.length ? Math.min(...lows) : null;

    // Posiciones del precio actual en cada rango
    const pos7 = w7 && p != null ? pctPos(w7.min, w7.max, p) : null;
    const pos15 = w15 && p != null ? pctPos(w15.min, w15.max, p) : null;
    const pos30 = w30 && p != null ? pctPos(w30.min, w30.max, p) : null;
    const pos90 = w90 && p != null ? pctPos(w90.min, w90.max, p) : null;
    const pos180 = w180 && p != null ? pctPos(w180.min, w180.max, p) : null;
    const pos365 = w365 && p != null ? pctPos(w365.min, w365.max, p) : null;

    const fromAthPct = ath && p ? (p / ath - 1) * 100 : null;
    const athTag =
      fromAthPct == null
        ? "—"
        : fromAthPct <= -40
        ? "Lejos del ATH"
        : fromAthPct <= -15
        ? "A medio camino"
        : fromAthPct < 0
        ? "Cerca del ATH"
        : "Sobre ATH";

    const verdict = (() => {
      if (pos365 == null || ath == null || p == null)
        return "Sin señal suficiente.";
      if (pos365 < 0.2 && (fromAthPct ?? 0) <= -40)
        return "Cerca del piso anual y lejos del ATH: podría estar en zona de acumulación (riesgo medio/bajo).";
      if (pos365 > 0.8 && (fromAthPct ?? 0) >= -10)
        return "Cerca del techo anual y relativamente próximo al ATH: alto riesgo de toma de ganancias.";
      if (pos365 >= 0.4 && pos365 <= 0.6)
        return "En la mitad del rango anual: escenario neutral/lateral.";
      if (pos365 < 0.4)
        return "En la banda inferior del rango anual: sesgo favorable si se sostiene.";
      return "En la banda superior del rango anual: sesgo prudente si no rompe con volumen.";
    })();

    const bullets = [
      oneLiner(pos7, "Muy corto (7d)"),
      oneLiner(pos15, "Corto+ (15d)"),
      oneLiner(pos30, "Corto (30d)"),
      oneLiner(pos90, "Medio (3m)"),
      oneLiner(pos365, "Largo (1a)"),
    ];

    return {
      last: p,
      ath,
      atl,
      w7,
      w15,
      w30,
      w90,
      w180,
      w365,
      pos7,
      pos15,
      pos30,
      pos90,
      pos180,
      pos365,
      fromAthPct,
      athTag,
      verdict,
      bullets,
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

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-3">
      <div className="text-lg font-semibold">{asset} — Rangos y ATH</div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">Precio actual</div>
          <div className="font-semibold tabular-nums">{fmt(summary.last)}</div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="flex items-center justify-between">
            <div className="text-neutral-400 text-xs">ATH (aprox.)</div>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-neutral-800 border border-neutral-700">
              {summary.athTag}
            </span>
          </div>
          <div className="font-semibold tabular-nums">{fmt(summary.ath)}</div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">% desde ATH</div>
          <div className="font-semibold tabular-nums">
            {summary.fromAthPct == null
              ? "—"
              : `${
                  summary.fromAthPct >= 0 ? "+" : ""
                }${summary.fromAthPct.toFixed(2)}%`}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="text-neutral-400 text-xs">ATL (aprox.)</div>
          <div className="font-semibold tabular-nums">{fmt(summary.atl)}</div>
        </div>
      </div>

      {/* 7 días */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>7 días</span>
          <span>
            {fmt(summary.w7?.min)} – {fmt(summary.w7?.max)}
          </span>
        </div>
        <RangeBar pos={summary.pos7} />
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
        </div>
      </div>

      {/* 15 días */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>15 días</span>
          <span>
            {fmt(summary.w15?.min)} – {fmt(summary.w15?.max)}
          </span>
        </div>
        <RangeBar pos={summary.pos15} />
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
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
        <RangeBar pos={summary.pos30} />
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
        </div>
      </div>

      {/* 3 meses */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>3 meses</span>
          <span>
            {fmt(summary.w90?.min)} – {fmt(summary.w90?.max)}
          </span>
        </div>
        <RangeBar pos={summary.pos90} />
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
        </div>
      </div>

      {/* 6 meses */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>6 meses</span>
          <span>
            {fmt(summary.w180?.min)} – {fmt(summary.w180?.max)}
          </span>
        </div>
        <RangeBar pos={summary.pos180} />
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
        </div>
      </div>

      {/* 1 año */}
      <div className="grid gap-1">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>1 año</span>
          <span>
            {fmt(summary.w365?.min)} – {fmt(summary.w365?.max)}
          </span>
        </div>
        <RangeBar pos={summary.pos365} />
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>barato</span>
          <span>medio</span>
          <span>caro</span>
        </div>
      </div>

      {/* veredicto + bullets por horizonte */}
      <div className="text-sm text-neutral-200">{summary.verdict}</div>
      <ul className="text-xs text-neutral-400 list-disc pl-5 space-y-1">
        {summary.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      <div className="text-xs text-neutral-500">
        *Datos 1D vía proxy. Material educativo, no es recomendación financiera.
      </div>
    </section>
  );
}
