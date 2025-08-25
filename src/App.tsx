import React, { useEffect, useMemo, useRef, useState } from "react";

/* ===== Types ===== */
type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL"; // compat: si falta, es SELL
};

type PriceMap = Record<string, number>;

/* ===== Storage keys ===== */
const LS_ORDERS = "simple_orders_v1";
const LS_PRICES = "simple_prices_v1";
const LS_TARGETS = "simple_targets_v1";

/* ===== Utils ===== */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const dateStr = (ms: number) => new Date(ms).toLocaleString();
const cn = (...a: (string | false | null | undefined)[]) =>
  a.filter(Boolean).join(" ");

/** Chip simple para “BUY/SELL” y resúmenes */
function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "red";
}) {
  const base = "px-2 py-0.5 rounded-full text-xs font-semibold border";
  const tones: Record<string, string> = {
    neutral: "bg-neutral-800 text-neutral-200 border-neutral-700",
    green:
      "bg-emerald-600/15 text-emerald-300 border-emerald-700/40 tabular-nums",
    red: "bg-rose-600/15 text-rose-300 border-rose-700/40 tabular-nums",
  };
  return <span className={cn(base, tones[tone])}>{children}</span>;
}

/* ===== Config ===== */
// Auto-refresh (pensado para evitar rate limits)
const REFRESH_MS_DEFAULT = 60000; // 60s
// Fee spot Binance (VIP 0) sin BNB
const FEE_RATE_SPOT = 0.001; // 0.10%

/* ===== Binance symbols ===== */
const BINANCE_SYMBOLS: Record<string, string> = {
  ETH: "ETHUSDT",
  BTC: "BTCUSDT",
  SOL: "SOLUSDT",
  ADA: "ADAUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
};

function toBinancePairs(symbols: string[]) {
  const out: string[] = [];
  symbols.forEach((s) => {
    const pair = BINANCE_SYMBOLS[s.toUpperCase()];
    if (pair) out.push(pair);
  });
  return Array.from(new Set(out));
}

/** Δ bruto vs actual según tipo */
function diffVsActual(o: Order, current: number) {
  const side = o.side ?? "SELL";
  return side === "SELL"
    ? (o.price - current) * o.qty // SELL: precio sube => pérdida
    : (current - o.price) * o.qty; // BUY: precio sube => ganancia
}

export default function App() {
  /* ===== State ===== */
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_ORDERS) || "[]");
    } catch {
      return [];
    }
  });

  const [prices, setPrices] = useState<PriceMap>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_PRICES) || "{}") || {};
    } catch {
      return {};
    }
  });

  const [targets] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_TARGETS) || "{}") || {};
    } catch {
      return {};
    }
  });

  const [form, setForm] = useState({
    asset: "ETH",
    qty: 1,
    price: 100,
    side: "SELL" as "BUY" | "SELL",
  });

  // Carga y última actualización
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  /* ===== Toasts ===== */
  type Toast = {
    id: string;
    msg: string;
    variant?: "success" | "error" | "info";
  };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (msg: string, variant: Toast["variant"] = "success") => {
    const t = { id: uid(), msg, variant };
    setToasts((prev) => [...prev, t]);
    setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
      4000
    );
  };

  // Para detectar cruces (ganancia/pérdida) y objetivos
  const prevSignRef = useRef<Record<string, number>>({});
  const prevTargetHitRef = useRef<Record<string, boolean>>({});

  /* ===== Persistencia ===== */
  useEffect(() => {
    localStorage.setItem(LS_ORDERS, JSON.stringify(orders));
  }, [orders]);
  useEffect(() => {
    localStorage.setItem(LS_PRICES, JSON.stringify(prices));
  }, [prices]);

  /* ===== Helpers ===== */
  const addOrder = () => {
    if (!form.asset || !form.qty || !form.price) return;
    const o: Order = {
      id: uid(),
      ts: Date.now(),
      asset: form.asset.toUpperCase().trim(),
      qty: Number(form.qty),
      price: Number(form.price),
      side: form.side,
    };
    setOrders((prev) => [o, ...prev]);
  };

  const removeOrder = (id: string) =>
    setOrders((prev) => prev.filter((o) => o.id !== id));

  /* ===== Fetch prices from Binance ===== */
  const fetchPricesBatch = async (symbols: string[]) => {
    const pairs = toBinancePairs(symbols);
    if (!pairs.length) return;

    setLoading(true);

    const pairToSym: Record<string, string> = {};
    Object.entries(BINANCE_SYMBOLS).forEach(([sym, pair]) => {
      pairToSym[pair] = sym;
    });

    const updates: PriceMap = {};
    for (const pair of pairs) {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`
        );
        if (!res.ok) throw new Error(String(res.status));
        const data: any = await res.json();
        const price = Number(data?.price);
        const sym = pairToSym[pair];
        if (sym && Number.isFinite(price)) updates[sym] = price;
      } catch (e) {
        console.error("fetchPricesBatch error for", pair, e);
        pushToast(`No pude traer ${pair}`, "error");
      }
    }

    if (Object.keys(updates).length) {
      setPrices((prev) => ({ ...prev, ...updates }));
      setLastUpdated(Date.now());
    }
    setLoading(false);
  };

  // Qué símbolos trackear
  const trackedSymbols = useMemo(() => {
    const set = new Set<string>();
    if (form.asset) set.add(form.asset.toUpperCase());
    orders.forEach((o) => set.add(o.asset.toUpperCase()));
    return Array.from(set).filter((a) => BINANCE_SYMBOLS[a]);
  }, [orders, form.asset]);

  /* ===== Auto-refresh + visibility ===== */
  useEffect(() => {
    let interval: any = null;
    const computeTracked = () =>
      Array.from(
        new Set([
          ...Object.keys(prices),
          form.asset,
          ...orders.map((o) => o.asset),
        ])
      );

    const start = () => {
      fetchPricesBatch(computeTracked());
      interval = setInterval(
        () => fetchPricesBatch(computeTracked()),
        REFRESH_MS_DEFAULT
      );
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        stop();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [prices, orders, form.asset]);

  /* ===== Toasts por cruce ganancia/pérdida según BUY/SELL ===== */
  useEffect(() => {
    orders.forEach((o) => {
      const current = prices[o.asset] || 0;
      const d = diffVsActual(o, current);
      const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
      const prev = prevSignRef.current[o.id];
      if (prev === undefined) {
        prevSignRef.current[o.id] = sign;
      } else if (prev !== sign) {
        if (sign === 1)
          pushToast(
            `✅ Ganancia en ${o.side ?? "SELL"} ${o.asset}: ${money.format(d)}`,
            "success"
          );
        if (sign === -1)
          pushToast(
            `⚠️ Pérdida en ${o.side ?? "SELL"} ${o.asset}: ${money.format(
              Math.abs(d)
            )}`,
            "error"
          );
        prevSignRef.current[o.id] = sign;
      }
    });
  }, [prices, orders]);

  /* ===== Toasts por objetivo ===== */
  useEffect(() => {
    Object.keys(targets).forEach((sym) => {
      const tgt = targets[sym];
      if (!tgt) return;
      const curr = prices[sym] || 0;
      const hit = curr >= tgt;
      const prev = prevTargetHitRef.current[sym];
      if (prev === undefined) {
        prevTargetHitRef.current[sym] = hit;
      } else if (!prev && hit) {
        pushToast(
          `🎯 ${sym} alcanzó el objetivo: ${money.format(curr)}`,
          "info"
        );
        prevTargetHitRef.current[sym] = hit;
      } else {
        prevTargetHitRef.current[sym] = hit;
      }
    });
  }, [prices, targets]);

  /* ===== Title pulse cuando haya ganancia en alguna ===== */
  const titlePulseIdRef = useRef<any>(null);
  const originalTitleRef = useRef<string>(document.title);
  useEffect(() => {
    const anyGain = orders.some((o) => {
      const current = prices[o.asset] || 0;
      return diffVsActual(o, current) > 0;
    });
    const start = () => {
      if (titlePulseIdRef.current) return;
      let on = false;
      titlePulseIdRef.current = setInterval(() => {
        on = !on;
        document.title = (on ? "🟢 " : " ") + originalTitleRef.current;
      }, 800);
    };
    const stop = () => {
      if (titlePulseIdRef.current) {
        clearInterval(titlePulseIdRef.current);
        titlePulseIdRef.current = null;
      }
      document.title = originalTitleRef.current;
    };
    if (anyGain) start();
    else stop();
    return () => stop();
  }, [prices, orders]);

  /* ===== Render ===== */
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-8">
      <div className="w-full mx-auto grid gap-6">
        {/* Toasts */}
        <div className="fixed top-4 right-4 space-y-2 z-50">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "px-4 py-2 rounded-lg text-white shadow-lg",
                t.variant === "error"
                  ? "bg-rose-600"
                  : t.variant === "info"
                  ? "bg-sky-600"
                  : "bg-emerald-600"
              )}
            >
              {t.msg}
            </div>
          ))}
        </div>

        {/* Top bar */}
        <section className="sticky top-0 z-40 p-3 rounded-2xl border border-neutral-800 bg-neutral-900/70 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/50">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={form.asset}
              onChange={(e) =>
                setForm((f) => ({ ...f, asset: e.target.value }))
              }
              className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-sm"
            >
              {Object.keys(BINANCE_SYMBOLS).map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>

            <span className="text-sm text-neutral-400">Precio actual</span>
            <span className="text-xl font-semibold tabular-nums">
              {prices[form.asset] ? money.format(prices[form.asset]) : "—"}
            </span>

            <button
              onClick={() => fetchPricesBatch(trackedSymbols)}
              disabled={loading}
              className={cn(
                "px-3 py-2 rounded-xl text-sm",
                loading
                  ? "opacity-50 cursor-not-allowed bg-white/10"
                  : "bg-white/10 hover:bg-white/20"
              )}
            >
              {loading ? "Actualizando..." : "Actualizar ahora"}
            </button>

            <div className="grow" />
            {lastUpdated && (
              <span className="text-sm text-neutral-400">
                Última: {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </div>
        </section>

        {/* Agregar orden */}
        <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 grid gap-4">
          <div className="text-lg font-semibold">Agregar orden</div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {/* Tipo */}
            <div className="col-span-1">
              <div className="text-xs text-neutral-400 mb-1">Tipo</div>
              <div className="inline-flex rounded-xl overflow-hidden border border-neutral-700">
                <button
                  onClick={() => setForm((f) => ({ ...f, side: "SELL" }))}
                  className={cn(
                    "px-3 py-2 text-sm",
                    form.side === "SELL"
                      ? "bg-rose-600/20 text-rose-300"
                      : "bg-neutral-900 text-neutral-300"
                  )}
                >
                  SELL
                </button>
                <button
                  onClick={() => setForm((f) => ({ ...f, side: "BUY" }))}
                  className={cn(
                    "px-3 py-2 text-sm border-l border-neutral-700",
                    form.side === "BUY"
                      ? "bg-emerald-600/20 text-emerald-300"
                      : "bg-neutral-900 text-neutral-300"
                  )}
                >
                  BUY
                </button>
              </div>
            </div>

            {/* Activo */}
            <div>
              <div className="text-xs text-neutral-400 mb-1">Activo</div>
              <input
                type="text"
                value={form.asset}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    asset: e.target.value.toUpperCase(),
                  }))
                }
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
              />
            </div>

            {/* Cantidad */}
            <div>
              <div className="text-xs text-neutral-400 mb-1">Cantidad</div>
              <input
                type="number"
                step="0.000001"
                inputMode="decimal"
                value={form.qty}
                onChange={(e) =>
                  setForm((f) => ({ ...f, qty: Number(e.target.value) }))
                }
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
              />
            </div>

            {/* Precio */}
            <div>
              <div className="text-xs text-neutral-400 mb-1">Precio USD</div>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={form.price}
                onChange={(e) =>
                  setForm((f) => ({ ...f, price: Number(e.target.value) }))
                }
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
              />
              <div className="text-[11px] text-neutral-500 mt-1">
                Sugerido:{" "}
                <button
                  className="underline hover:no-underline"
                  onClick={() =>
                    prices[form.asset] &&
                    setForm((f) => ({
                      ...f,
                      price: Number(prices[form.asset].toFixed(2)),
                    }))
                  }
                >
                  usar precio actual
                </button>
              </div>
            </div>

            {/* Acción */}
            <div className="flex items-end">
              <button
                onClick={addOrder}
                className="w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold"
              >
                Añadir
              </button>
            </div>
          </div>
        </section>

        {/* Tabla de órdenes */}
        <section className="rounded-2xl overflow-auto border border-neutral-800 max-h-[65vh]">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/70 sticky top-0 backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Activo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Fee operación (0.10%)</th>
                <th className="px-3 py-2 text-right">Δ vs actual</th>
                <th className="px-3 py-2 text-right">Δ neto (cerrar ahora)</th>
                <th className="px-3 py-2 text-right">Break-even USD</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="[&_tr:nth-child(even)]:bg-neutral-900/20">
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="text-center text-neutral-500 py-6"
                  >
                    Sin órdenes aún
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const current = prices[o.asset] || 0;
                  const side = o.side ?? "SELL";
                  const isSell = side === "SELL";

                  // Total y fee de la operación registrada
                  const totalUsd = o.qty * o.price;
                  const feeOpUsd = totalUsd * FEE_RATE_SPOT;

                  // Δ bruto vs precio actual
                  const diff = diffVsActual(o, current);

                  // Δ neto al cerrar ahora (incluye fees)
                  let deltaUsdCloseNow = 0;
                  if (isSell) {
                    // SELL: recomprar ahora
                    const usdtAfterSell = totalUsd * (1 - FEE_RATE_SPOT);
                    if (current > 0) {
                      const baseRebuyGross = usdtAfterSell / current;
                      const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT;
                      const baseRebuyNet = baseRebuyGross - feeBuyBase;
                      const deltaBase = baseRebuyNet - o.qty;
                      deltaUsdCloseNow = deltaBase * current;
                    }
                  } else {
                    // BUY: vender ahora
                    const proceedsAfterSell =
                      o.qty * current * (1 - FEE_RATE_SPOT);
                    const costWithFee = totalUsd * (1 + FEE_RATE_SPOT); // fee compra aprox.
                    deltaUsdCloseNow = proceedsAfterSell - costWithFee;
                  }

                  // Break-even (precio que haría neto = 0)
                  const breakEven = isSell
                    ? o.price * Math.pow(1 - FEE_RATE_SPOT, 2)
                    : o.price * ((1 + FEE_RATE_SPOT) / (1 - FEE_RATE_SPOT));

                  return (
                    <tr key={o.id} className="border-t border-neutral-900/60">
                      <td className="px-3 py-2">{dateStr(o.ts)}</td>
                      <td className="px-3 py-2">
                        <Pill tone={isSell ? "red" : "green"}>{side}</Pill>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{o.asset}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {o.qty}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money.format(o.price)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money.format(totalUsd)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money.format(feeOpUsd)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-semibold tabular-nums",
                          diff >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {money.format(diff)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-semibold tabular-nums",
                          deltaUsdCloseNow >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        )}
                      >
                        {money.format(deltaUsdCloseNow)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money.format(breakEven)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeOrder(o.id)}
                          className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20"
                        >
                          borrar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        {/* Test rápido */}
        <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/20 grid gap-3">
          <div className="text-sm font-semibold">Test rápido de toasts</div>
          <div className="text-xs text-neutral-400">
            Usa estos botones para simular ganancia/pérdida sobre el activo
            seleccionado sin esperar al mercado.
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => {
                const last = orders.find(
                  (o) => o.asset.toUpperCase() === form.asset.toUpperCase()
                );
                const base = last ? last.price : prices[form.asset] || 0;
                const target =
                  base > 0 ? base * 0.98 : (prices[form.asset] || 0) * 0.9; // 2% por debajo
                setPrices((p) => ({
                  ...p,
                  [form.asset]: Number(target.toFixed(2)),
                }));
              }}
              className="px-3 py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 text-sm"
            >
              Forzar ganancia ({form.asset})
            </button>
            <button
              onClick={() => {
                const last = orders.find(
                  (o) => o.asset.toUpperCase() === form.asset.toUpperCase()
                );
                const base = last ? last.price : prices[form.asset] || 0;
                const target =
                  base > 0 ? base * 1.02 : (prices[form.asset] || 0) * 1.1; // 2% por encima
                setPrices((p) => ({
                  ...p,
                  [form.asset]: Number(target.toFixed(2)),
                }));
              }}
              className="px-3 py-2 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-sm"
            >
              Forzar pérdida ({form.asset})
            </button>
            <button
              onClick={() => fetchPricesBatch(trackedSymbols)}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm"
            >
              Actualizar ahora
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
