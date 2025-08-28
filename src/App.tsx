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

/** Chip simple para “BUY/SELL” */
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
const REFRESH_MS_DEFAULT = 60000; // 60s auto-refresh
const FEE_RATE_SPOT = 0.0015; // 0.10% Binance

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

/** Δ bruto vs actual según tipo (positivo = a favor) */
function diffVsActual(o: Order, current: number) {
  const side = o.side ?? "SELL";
  return side === "SELL"
    ? (o.price - current) * o.qty // SELL: si el precio baja vs tu venta, ganás
    : (current - o.price) * o.qty; // BUY: si el precio sube vs tu compra, ganás
}

/** Fee en USDT del cierre (tu definición mobile): 0.15% sobre valor actual en USDT */
function feeCloseUsdSimple(o: Order, current: number) {
  return current > 0 ? o.qty * current * FEE_RATE_SPOT : 0;
}

/** NUEVO: Δ % vs precio de entrada, signo favorable según lado */
function pctDiffVsEntry(o: Order, current: number) {
  if (!o.price || !Number.isFinite(current) || current <= 0) return null;
  const side = o.side ?? "SELL";
  // BUY: (current - entry) / entry ; SELL: (entry - current) / entry
  const pct =
    side === "SELL"
      ? (o.price - current) / o.price
      : (current - o.price) / o.price;
  return pct * 100;
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

  const [form, setForm] = useState({
    asset: "ETH",
    qty: 1,
    price: 100,
    side: "SELL" as "BUY" | "SELL",
  });

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

  const prevSignRef = useRef<Record<string, number>>({});

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

  const trackedSymbols = useMemo(() => {
    const set = new Set<string>();
    if (form.asset) set.add(form.asset.toUpperCase());
    orders.forEach((o) => set.add(o.asset.toUpperCase()));
    return Array.from(set).filter((a) => BINANCE_SYMBOLS[a]);
  }, [orders, form.asset]);

  /* ===== Auto-refresh (siempre activo) ===== */
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

    const tick = () => fetchPricesBatch(computeTracked());

    // primer fetch inmediato
    tick();
    // seguir refrescando incluso en background (el navegador puede trottle, pero no se pausa)
    interval = setInterval(tick, REFRESH_MS_DEFAULT);

    // si volvés a la tab, hacé un fetch inmediato para “catch up”
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
    // Dependencias: cuando cambian, recomputamos tracked y reiniciamos el intervalo
  }, [prices, orders, form.asset]);

  /* ===== Toasts por cruces (usando Δ bruto) ===== */
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

  /* ===== Neto total (cerrar ahora) ===== */
  const totalNetNow = useMemo(() => {
    return orders.reduce((sum, o) => {
      const current = prices[o.asset] || 0;
      const side = o.side ?? "SELL";
      const isSell = side === "SELL";
      const totalUsd = o.qty * o.price;

      let deltaUsdCloseNow = 0;
      if (isSell) {
        // SELL: recomprar ahora (fee en base)
        if (current > 0) {
          const baseRebuyGross = totalUsd / current;
          const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT; // fee en base
          const baseRebuyNet = baseRebuyGross - feeBuyBase;
          const deltaBase = baseRebuyNet - o.qty;
          deltaUsdCloseNow = deltaBase * current;
        }
      } else {
        // BUY: vender ahora (fee de venta)
        const proceedsAfterSell = o.qty * current * (1 - FEE_RATE_SPOT);
        const cost = totalUsd; // fee de compra histórico ya pagado
        deltaUsdCloseNow = proceedsAfterSell - cost;
      }

      return sum + deltaUsdCloseNow;
    }, 0);
  }, [orders, prices]);

  // % global: valor actual vs valor de entrada total
  const totalPctNow = useMemo(() => {
    let entryUsd = 0;
    let currentUsd = 0;

    orders.forEach((o) => {
      const current = prices[o.asset] || 0;
      if (!o.price || !current) return;

      const side = o.side ?? "SELL";
      const totalUsd = o.qty * o.price;

      if (side === "BUY") {
        entryUsd += totalUsd; // invertiste esto
        currentUsd += o.qty * current; // vale esto ahora
      } else {
        entryUsd += totalUsd; // vendiste y recibiste esto
        currentUsd += o.qty * current; // te costaría recomprarlo ahora
      }
    });

    if (entryUsd <= 0) return null;
    return ((currentUsd - entryUsd) / entryUsd) * 100;
  }, [orders, prices]);

  // === Neto "simple" para MOBILE: sum(Bruto − Fee(USDT))
  const totalNetNowSimple = useMemo(() => {
    return orders.reduce((sum, o) => {
      const current = prices[o.asset] || 0;
      const bruto = diffVsActual(o, current);
      const feeUsd = feeCloseUsdSimple(o, current);
      return sum + (bruto - feeUsd);
    }, 0);
  }, [orders, prices]);

  void totalNetNowSimple; // ✅ cuenta como lectura, no afecta el bundle

  // Mostrar total neto (modelo completo) en el título desktop
  useEffect(() => {
    const positive = totalNetNow >= 0;
    const light = positive ? "🟢" : "🔴";
    const pctStr =
      typeof totalPctNow === "number"
        ? ` (${totalPctNow >= 0 ? "+" : ""}${totalPctNow.toFixed(2)}%)`
        : "";
    document.title = `${light} Neto: ${money.format(totalNetNow)}${pctStr}`;
  }, [totalNetNow, totalPctNow]);

  /* ===== Render ===== */
  const first = orders[0];
  const firstCurrent = first ? prices[first.asset] || 0 : 0;
  const firstBruto = first ? diffVsActual(first, firstCurrent) : 0;
  const firstFeeUsd = first ? feeCloseUsdSimple(first, firstCurrent) : 0;
  const firstNetoSimple = first ? firstBruto - firstFeeUsd : 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-8">
      <div className="w-full mx-auto grid gap-6">
        {/* ===== Toasts ===== */}
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

        {/* ===== RESUMEN MOBILE (Orden 1 + Neto simple) ===== */}
        <section className="md:hidden order-0 p-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur">
          {/* Orden 1 */}
          {first ? (
            <div>
              <div className="flex items-center gap-2">
                <Pill
                  tone={(first.side ?? "SELL") === "SELL" ? "red" : "green"}
                >
                  {first.side ?? "SELL"}
                </Pill>
                <span className="font-semibold">{first.asset}</span>
                <span className="text-xs text-neutral-400">
                  {dateStr(first.ts)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-400">Qty</span>
                  <span className="tabular-nums">{first.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Entrada</span>
                  <span className="tabular-nums">
                    {money.format(first.price)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Precio act.</span>
                  <span className="tabular-nums">
                    {firstCurrent ? money.format(firstCurrent) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Δ %</span>
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      (() => {
                        const pct = pctDiffVsEntry(first, firstCurrent);
                        return (pct ?? 0) >= 0
                          ? "text-emerald-400"
                          : "text-rose-400";
                      })()
                    )}
                  >
                    {(() => {
                      const pct = pctDiffVsEntry(first, firstCurrent);
                      return pct == null
                        ? "—"
                        : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
                    })()}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-neutral-400">Bruto</span>
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      firstBruto >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}
                  >
                    {money.format(firstBruto)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Neto</span>
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      firstNetoSimple >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    )}
                  >
                    {money.format(firstNetoSimple)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-neutral-500">Sin órdenes aún</div>
          )}
        </section>

        {/* ===== Top bar (desktop) ===== */}
        <section className="sticky top-0 z-40 p-3 rounded-2xl border border-neutral-800 bg-neutral-900/70 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/50 order-2 md:order-none">
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

        {/* ===== Agregar orden ===== */}
        <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 grid gap-4 order-3 md:order-none">
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

        {/* ===== Tabla de órdenes (arriba en mobile) ===== */}
        <section className="rounded-2xl overflow-auto border border-neutral-800 order-1 md:order-none">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/70 sticky top-0 backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Activo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Fee operación (0.15%)</th>
                <th className="px-3 py-2 text-right">Δ vs actual</th>
                {/* NUEVO */}
                <th className="px-3 py-2 text-right">Δ % vs entrada</th>
                <th className="px-3 py-2 text-right">Δ neto (cerrar ahora)</th>
                <th className="px-3 py-2 text-right">Break-even USD</th>
                <th className="px-3 py-2 text-right">
                  USDT sobrantes (cerrar ahora)
                </th>
                <th className="px-3 py-2 text-right">
                  ETH objetivo (recomprando TODO ahora)
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody className="[&_tr:nth-child(even)]:bg-neutral-900/20">
              {orders.length === 0 ? (
                <tr>
                  {/* colSpan actualizado por nueva columna */}
                  <td
                    colSpan={14}
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

                  const totalUsd = o.qty * o.price;

                  // Δ bruto vs precio actual
                  const diff = diffVsActual(o, current);

                  // NUEVO: Δ % vs entrada
                  const pct = pctDiffVsEntry(o, current);
                  const pctStr =
                    pct == null
                      ? "—"
                      : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

                  // Fee de la operación de CIERRE (modelo “tabla original”)
                  let feeCloseUsd = 0;
                  if (isSell) {
                    if (current > 0) {
                      const baseRebuyGross = totalUsd / current;
                      const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT; // en base
                      feeCloseUsd = feeBuyBase * current; // mostrado en USD
                    }
                  } else {
                    feeCloseUsd = o.qty * current * FEE_RATE_SPOT; // fee de venta
                  }

                  // Δ neto al cerrar ahora (modelo “tabla original”)
                  let deltaUsdCloseNow = 0;
                  if (isSell) {
                    if (current > 0) {
                      const baseRebuyGross = totalUsd / current;
                      const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT;
                      const baseRebuyNet = baseRebuyGross - feeBuyBase;
                      const deltaBase = baseRebuyNet - o.qty;
                      deltaUsdCloseNow = deltaBase * current;
                    }
                  } else {
                    const proceedsAfterSell =
                      o.qty * current * (1 - FEE_RATE_SPOT);
                    const cost = totalUsd;
                    deltaUsdCloseNow = proceedsAfterSell - cost;
                  }

                  // Break-even con solo fee de cierre
                  const breakEven = isSell
                    ? o.price * (1 - FEE_RATE_SPOT)
                    : o.price / (1 - FEE_RATE_SPOT);

                  // USDT sobrantes (cerrar ahora)
                  let usdtLeftoverCloseNow = 0;
                  if (!isSell) {
                    const proceedsAfterSell =
                      o.qty * current * (1 - FEE_RATE_SPOT);
                    const cost = totalUsd;
                    usdtLeftoverCloseNow = proceedsAfterSell - cost;
                  } else {
                    usdtLeftoverCloseNow = 0;
                  }

                  // ETH objetivo (recomprando TODO ahora)
                  let ethTargetRebuyAll: number | null = null;
                  let ethTargetDelta: number | null = null;
                  if (isSell && current > 0) {
                    const baseRebuyGross = totalUsd / current;
                    const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT;
                    const baseRebuyNet = baseRebuyGross - feeBuyBase; // ETH objetivo
                    ethTargetRebuyAll = baseRebuyNet;
                    ethTargetDelta = baseRebuyNet - o.qty;
                  }

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
                        {money.format(feeCloseUsd)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-semibold tabular-nums",
                          diff >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {money.format(diff)}
                      </td>

                      {/* NUEVO: Δ % vs entrada */}
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-semibold tabular-nums",
                          (pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {pctStr}
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
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          usdtLeftoverCloseNow >= 0
                            ? "text-emerald-300"
                            : "text-rose-300"
                        )}
                      >
                        {money.format(usdtLeftoverCloseNow)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {ethTargetRebuyAll == null ? (
                          <span className="text-neutral-500">—</span>
                        ) : (
                          <div className="inline-flex flex-col items-end leading-tight">
                            <span>{ethTargetRebuyAll.toFixed(6)} ETH</span>
                            <span
                              className={cn(
                                "text-xs font-semibold",
                                (ethTargetDelta ?? 0) >= 0
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                              )}
                            >
                              {(ethTargetDelta ?? 0) >= 0 ? "+" : ""}
                              {ethTargetDelta?.toFixed(6)} ETH
                            </span>
                          </div>
                        )}
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
      </div>
    </div>
  );
}
