import { useMemo, useState } from "react";

/* Helpers locales */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const cn = (...a: (string | false | null | undefined)[]) =>
  a.filter(Boolean).join(" ");

const DEFAULT_FEE_RATE_SPOT = 0.001;

function proceedsSellUSDT(
  q: number,
  p: number,
  feeRate = DEFAULT_FEE_RATE_SPOT
) {
  return q * p * (1 - feeRate);
}
function costBuyUSDT(q: number, p: number, feeRate = DEFAULT_FEE_RATE_SPOT) {
  return q * p * (1 + feeRate);
}

export function DropLadderSimulator({
  asset,
  currentPrice,
  defaultQty = 6,
  step = 100,
  rows = 10,
  feeRate = DEFAULT_FEE_RATE_SPOT,
}: {
  asset: string;
  currentPrice: number;
  defaultQty?: number;
  step?: number;
  rows?: number;
  feeRate?: number;
}) {
  const [qty, setQty] = useState<number>(defaultQty);
  const [stk, setStep] = useState<number>(step);
  const [cnt, setRows] = useState<number>(rows);

  const valid = Number.isFinite(currentPrice) && currentPrice > 0 && qty > 0;

  const ladder = useMemo(() => {
    if (!valid) return [];
    const out: Array<{
      target: number;
      leftoverA: number; // USDT sobrantes (misma qty)
      ethExtraB: number; // ETH extra (con todo)
    }> = [];

    const proceeds = proceedsSellUSDT(qty, currentPrice, feeRate);

    for (let i = 1; i <= cnt; i++) {
      const target = currentPrice - i * stk;
      if (target <= 0) break;

      const repurchaseCostA = costBuyUSDT(qty, target, feeRate);
      const leftoverA = proceeds - repurchaseCostA;

      const ethBoughtB = proceeds / (target * (1 + feeRate));
      const ethExtraB = ethBoughtB - qty;

      out.push({ target, leftoverA, ethExtraB });
    }
    return out;
  }, [valid, qty, currentPrice, feeRate, stk, cnt]);

  return (
    <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-lg font-semibold">
          Escalera de caídas — vender ahora {qty} {asset} a{" "}
          <span className="tabular-nums">{money.format(currentPrice)}</span>
        </div>
        <div className="text-xs text-neutral-500">
          Fee spot {Math.round(feeRate * 1000) / 10}% (en USDT)
        </div>
      </div>

      {/* Controles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-neutral-400 mb-1">
            ETH a vender ahora
          </div>
          <input
            type="number"
            step="0.000001"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
          />
        </div>
        <div>
          <div className="text-xs text-neutral-400 mb-1">Escalón (USD)</div>
          <input
            type="number"
            step="1"
            value={stk}
            onChange={(e) => setStep(Number(e.target.value))}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
          />
        </div>
        <div>
          <div className="text-xs text-neutral-400 mb-1">Filas</div>
          <input
            type="number"
            step="1"
            min={1}
            value={cnt}
            onChange={(e) => setRows(Number(e.target.value))}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
          />
        </div>
        <div className="flex items-end">
          <div className="text-sm text-neutral-400">
            Par:{" "}
            <span className="text-neutral-200 font-medium">{asset} / USDT</span>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-2xl overflow-auto border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/70 sticky top-0 backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-right">Δ vs actual</th>
              <th className="px-3 py-2 text-right">
                Opción A · USDT sobrantes
              </th>
              <th className="px-3 py-2 text-right">Opción B · Δ ETH</th>
            </tr>
          </thead>
          <tbody className="[&_tr:nth-child(even)]:bg-neutral-900/20">
            {!valid || ladder.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-neutral-500 py-6">
                  {valid
                    ? "Sin niveles válidos"
                    : "Completá cantidad y precio actual"}
                </td>
              </tr>
            ) : (
              ladder.map((row) => {
                const deltaUsd = currentPrice - row.target;
                return (
                  <tr
                    key={row.target}
                    className="border-t border-neutral-900/60"
                  >
                    <td className="px-3 py-2">
                      <span className="tabular-nums">
                        {money.format(row.target)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      −{money.format(deltaUsd)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums font-semibold",
                        row.leftoverA > 0
                          ? "text-emerald-400"
                          : row.leftoverA < 0
                          ? "text-rose-400"
                          : "text-yellow-300"
                      )}
                    >
                      {money.format(row.leftoverA)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums font-semibold",
                        row.ethExtraB > 0
                          ? "text-emerald-400"
                          : row.ethExtraB < 0
                          ? "text-rose-400"
                          : "text-yellow-300"
                      )}
                    >
                      {row.ethExtraB >= 0 ? "+" : ""}
                      {row.ethExtraB.toFixed(6)} ETH
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-500">
        Opción A: recomprar la misma cantidad → USDT sobrantes. | Opción B:
        recomprar con todo → ETH extra.
      </div>
    </section>
  );
}
export default DropLadderSimulator;
