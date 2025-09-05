export type WindowAnalysis = {
  closes: number[];
  pct: number;
  min: number;
  max: number;
  smaFast: number | null;
  smaSlow: number | null;
  bias: "Alcista" | "Bajista" | "Lateral" | "Indefinido";
  label: string;
};

export type EthAnalysis = {
  last: number;
  short: WindowAnalysis; // 5m
  day: WindowAnalysis; // 1h (24h)
  long?: WindowAnalysis; // ← OPCIONAL por ahora
  ts: number;
};

function sparkPath(values: number[], w = 260, h = 64, padX = 6, padY = 6) {
  if (!values?.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  return values
    .map((v, i) => {
      const x = padX + (i * innerW) / (values.length - 1 || 1);
      const y = padY + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function Metric({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
      <div className="text-neutral-400 text-xs">{title}</div>
      <div className="font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export default function EthIntraday({
  data,
  loading,
  error,
}: {
  data?: EthAnalysis | null;
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
        <div className="text-neutral-400 text-sm">
          Cargando análisis intradiario de ETH…
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
        <div className="text-rose-400 text-sm">Error: {error}</div>
      </section>
    );
  }
  if (!data) return null;

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const colorPct = (v: number) =>
    v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-neutral-300";

  const Block = ({ w }: { w: WindowAnalysis }) => {
    const pctStr = `${w.pct >= 0 ? "+" : ""}${w.pct.toFixed(2)}%`;
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-neutral-400">{w.label}</div>
          <div className={`text-sm font-semibold ${colorPct(w.pct)}`}>
            {pctStr}
          </div>
        </div>

        <div className="rounded-xl bg-neutral-950/50 border border-neutral-800 p-3">
          <svg
            width="100%"
            height="64"
            viewBox="0 0 260 64"
            preserveAspectRatio="none"
          >
            <path
              d={sparkPath(w.closes, 260, 64)}
              fill="none"
              stroke={w.pct >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
          </svg>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Metric title="Rango">
            <span className="text-neutral-300">{money.format(w.min)}</span>
            <span className="text-neutral-500 mx-1">→</span>
            <span className="text-neutral-300">{money.format(w.max)}</span>
          </Metric>
          <Metric title="Medias">
            <span className="text-neutral-300">
              {w.smaFast != null ? `SMA(f): ${w.smaFast.toFixed(0)}` : "—"}
            </span>
            <span className="text-neutral-500 mx-1">/</span>
            <span className="text-neutral-300">
              {w.smaSlow != null ? `SMA(l): ${w.smaSlow.toFixed(0)}` : "—"}
            </span>
          </Metric>
          <Metric title="Sesgo">
            <span
              className={
                w.bias === "Alcista"
                  ? "text-emerald-400"
                  : w.bias === "Bajista"
                  ? "text-rose-400"
                  : "text-neutral-300"
              }
            >
              {w.bias}
            </span>
          </Metric>
          <Metric title="Precio actual">
            <span className="text-neutral-300">{money.format(data.last)}</span>
          </Metric>
        </div>

        <div className="text-sm text-neutral-300 leading-relaxed">
          <b>Lectura rápida:</b>{" "}
          {w.bias === "Alcista"
            ? "la media rápida está por encima de la lenta y el precio sostiene el impulso."
            : w.bias === "Bajista"
            ? "la media rápida está por debajo de la lenta y el precio pierde impulso."
            : "las medias están próximas entre sí; el movimiento es principalmente lateral."}{" "}
          El % indica el cambio dentro de la ventana y el rango muestra los
          extremos recientes para dimensionar volatilidad.
        </div>
      </div>
    );
  };

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">ETH — Intradía & 1 día</div>
        <div className="text-xs text-neutral-500">
          {new Date(data.ts).toLocaleTimeString()}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Block w={data.short} />
        <Block w={data.day} />
      </div>
    </section>
  );
}
export const __DEBUG__ = true;
