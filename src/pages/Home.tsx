import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import EthIntraday from "../components/EthIntraday";
import type { EthAnalysis } from "../components/EthIntraday";
import EthVerdict from "../components/EthVerdict";
import AssetRanges from "../components/AssetRanges";

import MarketHoursSummary from "../components/MarketHoursSummary";
import NewsSentimentSummary from "../components/NewsSentimentSummary";

import RebuySimulator from "../components/RebuySimulator";
import MarketBiasAnalyzer from "../components/MarketBiasAnalyzer";
import DropLadderSimulator from "../components/DropLadderSimulator";

/* ===== Types ===== */
type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};
type PriceMap = Record<string, number>;

/* ===== Storage keys ===== */
const LS_ORDERS = "simple_orders_v1";
const LS_PRICES = "simple_prices_v1";
const LS_FREQ_MIN = "push_freq_minutes_v1";

/* ===== Utils ===== */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
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
const FEE_RATE_SPOT = 0.0015; // 0.15% (para cierre)

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
    ? (o.price - current) * o.qty
    : (current - o.price) * o.qty;
}

/** Fee en USDT del cierre (def: 0.15% sobre valor actual en USDT) */
function feeCloseUsdSimple(o: Order, current: number) {
  return current > 0 ? o.qty * current * FEE_RATE_SPOT : 0;
}

/** Δ % vs precio de entrada, signo favorable según lado */
function pctDiffVsEntry(o: Order, current: number) {
  if (!o.price || !Number.isFinite(current) || current <= 0) return null;
  const side = o.side ?? "SELL";
  const pct =
    side === "SELL"
      ? (o.price - current) / o.price
      : (current - o.price) / o.price;
  return pct * 100;
}

/* ===== Push helpers (cliente) ===== */
// === Helpers ===
function base64urlToUint8Array(base64url: string) {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Usá SIEMPRE el mismo origen para funciones
const API_BASE = `${location.origin}/.netlify/functions`;

// ⚠️ Poné en tu build la pública: VITE_VAPID_PUBLIC_KEY = (misma que en el server)
const VAPID_PUBLIC_KEY =
  (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY || "<TU_PUBLIC_KEY_VAPID>";

async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("Tu navegador no soporta Push.");
    return;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("<")) {
    alert("Falta VAPID_PUBLIC_KEY en el cliente.");
    return;
  }

  try {
    const reg = await registerSW();
    if (!reg) throw new Error("No se pudo registrar el Service Worker");

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      alert("No diste permiso de notificaciones.");
      return;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = base64urlToUint8Array(VAPID_PUBLIC_KEY);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }

    const resp = await fetch(`${API_BASE}/save-subscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("save-subscription FAIL", resp.status, txt);
      alert("No se pudo guardar la suscripción en el servidor.");
      return;
    }

    console.log("SUBSCRIPTION JSON >>>", JSON.stringify(sub));
    alert("Notificaciones activadas ✔");
  } catch (err) {
    console.error("enablePush error", err);
    alert("Error al activar notificaciones.");
  }
}

export default function Home() {
  /* ===== State ===== */
  // ⬇️ Reemplazo: TTL de 10 minutos para recalcular análisis
  const ETH_ANALYSIS_TTL_MS = 10 * 60 * 1000;
  const lastEthAnalysisTsRef = useRef<number>(0);
  const [ethRefreshKey, setEthRefreshKey] = useState<number>(0);

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

  const [ethAnalysis, setEthAnalysis] = useState<EthAnalysis | null>(null);
  const [ethLoading, setEthLoading] = useState(false);
  const [ethError, setEthError] = useState<string | null>(null);

  const [form, setForm] = useState({
    asset: "ETH",
    qty: "",
    price: "",
    side: "SELL" as "BUY" | "SELL",
  });

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [pushSub, setPushSub] = useState<any | null>(null);

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

  const [freqMinutes, setFreqMinutes] = useState<number>(() => {
    const n = Number(localStorage.getItem(LS_FREQ_MIN) || "30");
    return Number.isFinite(n) && n > 0 ? n : 30;
  });

  const prevSignRef = useRef<Record<string, number>>({});
  const pushSentRef = useRef<Record<string, boolean>>({});

  function pickPrimaryOrder(orders: Order[]): Order | null {
    if (!orders?.length) return null;
    // 1) priorizá ETH (la más reciente)
    const eth = orders.find((o) => o.asset?.toUpperCase() === "ETH");
    return eth || orders[0];
  }

  async function postPrimaryToSW(order: Order | null) {
    try {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const msg = order
        ? {
            asset: order.asset,
            qty: Number(order.qty),
            price: Number(order.price),
            side: order.side || "SELL",
          }
        : null;

      reg.active?.postMessage({ type: "SET_PRIMARY_ORDER", order: msg });
    } catch {}
  }

  useEffect(() => {
    localStorage.setItem(LS_ORDERS, JSON.stringify(orders));
    postPrimaryToSW(pickPrimaryOrder(orders)); // 👈 sincroniza con el SW
  }, [orders]);
  useEffect(() => {
    localStorage.setItem(LS_PRICES, JSON.stringify(prices));
  }, [prices]);

  useEffect(() => {
    postPrimaryToSW(pickPrimaryOrder(orders));
    // también podrías re-suscribir pushSub aquí si lo necesitás
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) setPushSub(sub);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/save-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orders),
    }).catch(() => {});
  }, [orders]);

  const addOrder = () => {
    if (!form.asset || !form.qty || !form.price) return;
    const qtyNum = parseDec(form.qty as string);
    const priceNum = parseDec(form.price as string);
    if (!Number.isFinite(qtyNum) || !Number.isFinite(priceNum)) return;

    const o: Order = {
      id: uid(),
      ts: Date.now(),
      asset: form.asset.toUpperCase().trim(),
      qty: qtyNum,
      price: priceNum,
      side: form.side,
    };
    postPrimaryToSW(o);
    setOrders((prev) => [o, ...prev]);
    setForm((f) => ({ ...f, qty: "", price: "" }));
  };

  const clearLocal = () => {
    if (!confirm("¿Borrar órdenes y precios locales?")) return;
    localStorage.removeItem(LS_ORDERS);
    localStorage.removeItem(LS_PRICES);
    setOrders([]);
    setPrices({});
    setLastUpdated(null);
    pushToast("Almacenamiento local borrado", "info");
    postPrimaryToSW(null); // 👈 limpia en el SW (y cache)
  };

  const removeOrder = (id: string) =>
    setOrders((prev) => prev.filter((o) => o.id !== id));

  const fetchPricesBatch = async (symbols: string[]) => {
    const pairs = toBinancePairs(symbols);
    if (!pairs.length) return;
    setLoading(true);

    const pairToSym: Record<string, string> = {};
    Object.entries(BINANCE_SYMBOLS).forEach(([sym, pair]) => {
      pairToSym[pair] = sym;
    });

    const updates: PriceMap = {};
    try {
      // === 1) Precios spot simples
      await Promise.all(
        pairs.map(async (pair) => {
          const res = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`
          );
          if (!res.ok) throw new Error(String(res.status));
          const data: any = await res.json();
          const price = Number(data?.price);
          const sym = pairToSym[pair];
          if (sym && Number.isFinite(price)) updates[sym] = price;
        })
      );

      if (Object.keys(updates).length) {
        setPrices((prev) => ({ ...prev, ...updates }));
        setLastUpdated(Date.now());
      }

      // === 2) Análisis intradiario ETH (cada 10 minutos)
      const symbolsUpper = symbols.map((s) => s.toUpperCase());
      const needEthUpdate =
        symbolsUpper.includes("ETH") &&
        Date.now() - (lastEthAnalysisTsRef.current || 0) >= ETH_ANALYSIS_TTL_MS;
      setEthRefreshKey(Math.floor(Date.now() / (10 * 60 * 1000))); // 👈 cambia solo cada 10'

      if (needEthUpdate) {
        setEthLoading(true);
        setEthError(null);

        // Proxy Netlify → Binance (evita CORS)
        const k = (interval: string, limit: number) =>
          `/.netlify/functions/binance-proxy?symbol=ETHUSDT&interval=${interval}&limit=${limit}`;

        try {
          // Velas: 5m (36 ≈ 3h) y 1h (24 = 1 día)
          const [raw5m, raw1h] = await Promise.all([
            fetch(k("5m", 36)).then((r) => {
              if (!r.ok) throw new Error(`proxy 5m ${r.status}`);
              return r.json();
            }),
            fetch(k("1h", 24)).then((r) => {
              if (!r.ok) throw new Error(`proxy 1h ${r.status}`);
              return r.json();
            }),
          ]);

          const closes5m = (raw5m as any[])
            .map((k: any) => Number(k[4]))
            .filter(Number.isFinite);
          const closes1h = (raw1h as any[])
            .map((k: any) => Number(k[4]))
            .filter(Number.isFinite);

          const last =
            updates.ETH ??
            prices.ETH ??
            (closes5m.at(-1) || closes1h.at(-1) || 0);

          const pct = (arr: number[]) => {
            const a0 = arr[0] || 0;
            const an = arr.at(-1) || 0;
            return a0 ? ((an - a0) / a0) * 100 : 0;
          };
          const sma = (arr: number[], n: number) => {
            if (arr.length < n) return null;
            const s = arr.slice(-n).reduce((a, b) => a + b, 0);
            return s / n;
          };
          const bias = (
            fast: number | null,
            slow: number | null,
            thr = 0.002
          ) => {
            if (fast == null || slow == null || slow === 0)
              return "Indefinido" as const;
            const gap = (fast - slow) / slow;
            if (gap > thr) return "Alcista";
            if (gap < -thr) return "Bajista";
            return "Lateral";
          };

          const smaFast5 = sma(closes5m, 3);
          const smaSlow5 = sma(closes5m, 12);
          const shortWindow = {
            closes: closes5m,
            pct: pct(closes5m),
            min: Math.min(...closes5m),
            max: Math.max(...closes5m),
            smaFast: smaFast5,
            smaSlow: smaSlow5,
            bias: bias(smaFast5, smaSlow5, 0.002), // 0.2%
            label: "Corto plazo (5m · ~3h)",
          } as const;

          const smaFast1h = sma(closes1h, 6);
          const smaSlow1h = sma(closes1h, 24);
          const dayWindow = {
            closes: closes1h,
            pct: pct(closes1h),
            min: Math.min(...closes1h),
            max: Math.max(...closes1h),
            smaFast: smaFast1h,
            smaSlow: smaSlow1h,
            bias: bias(smaFast1h, smaSlow1h, 0.004), // 0.4%
            label: "1 día (1h · 24h)",
          } as const;

          setEthAnalysis({
            last,
            short: shortWindow,
            day: dayWindow,
            long: dayWindow, // temporal hasta calcular 1d real
            ts: Date.now(),
          });

          // ✅ Actualizamos el sello de tiempo del último análisis
          lastEthAnalysisTsRef.current = Date.now();
        } catch (e: any) {
          console.error("ETH intraday error:", e?.message || e);
          setEthError("No se pudo calcular el análisis intradiario de ETH.");
          // No actualizamos el timestamp para reintentar en el próximo tick
        } finally {
          setEthLoading(false);
        }
      }
    } catch (err: any) {
      console.error("fetchPricesBatch error:", err?.message || err);
    } finally {
      setLoading(false);
    }
  };

  const [draftFreq, setDraftFreq] = useState<number>(freqMinutes);
  const [savingFreq, setSavingFreq] = useState(false);

  const saveFrequency = async () => {
    try {
      setSavingFreq(true);
      const v = Math.max(1, Math.floor(Number(draftFreq) || 1));

      // 1) Guardar local
      localStorage.setItem(LS_FREQ_MIN, String(v));
      setFreqMinutes(v);

      // 2) Sync backend si hay suscripción
      if (pushSub?.endpoint) {
        const r = await fetch("/.netlify/functions/save-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: pushSub.endpoint, freqMinutes: v }),
        });
        if (!r.ok) throw new Error(await r.text());
      } else {
        // opcional: avisar que quedó local si querés
        // pushToast("Guardado local. Activá notificaciones para sincronizar.", "info");
      }

      pushToast("Frecuencia guardada ✔", "success");
    } catch (e) {
      console.error("saveFrequency error", e);
      pushToast("No pude guardar la frecuencia", "error");
    } finally {
      setSavingFreq(false);
    }
  };

  // === Hooks a NIVEL DE COMPONENTE (no dentro de funciones) ===
  const trackedSymbols = useMemo(() => {
    const set = new Set<string>();
    if (form.asset) set.add(form.asset.toUpperCase());
    orders.forEach((o) => set.add(o.asset.toUpperCase()));
    return Array.from(set).filter((a) => BINANCE_SYMBOLS[a]);
  }, [orders, form.asset]);

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

    tick();
    interval = setInterval(tick, REFRESH_MS_DEFAULT);

    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [prices, orders, form.asset]); // está bien: dependencias para recomputar "computeTracked"

  useEffect(() => {
    orders.forEach((o) => {
      const current = prices[o.asset] || 0;
      const d = diffVsActual(o, current);
      const sign = d > 0 ? 1 : d < 0 ? -1 : 0;

      const prev = prevSignRef.current[o.id];
      if (prev === undefined) {
        prevSignRef.current[o.id] = sign;
        pushSentRef.current[o.id] = sign === 1;
        return;
      }

      if (prev !== sign) {
        if (sign === 1) {
          pushToast(
            `✅ Ganancia en ${o.side ?? "SELL"} ${o.asset}: ${money.format(d)}`,
            "success"
          );
        } else if (sign === -1) {
          pushToast(
            `⚠️ Pérdida en ${o.side ?? "SELL"} ${o.asset}: ${money.format(
              Math.abs(d)
            )}`,
            "error"
          );
        }

        if (sign !== 1) pushSentRef.current[o.id] = false;

        if (sign === 1 && !pushSentRef.current[o.id]) {
          pushSentRef.current[o.id] = true;

          (async () => {
            try {
              const title = `🟢 Ganancia en ${o.asset}`;
              const body =
                `${o.side === "BUY" ? "Compra" : "Venta"} a ${money.format(
                  o.price
                )} · ` +
                `P/L ahora: +${money.format(d)} · Precio: ${money.format(
                  current
                )}`;

              const res = await fetch(`${API_BASE}/send-push`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title,
                  body,
                  subscription: pushSub ?? undefined,
                }),
              });

              const j = await res.json().catch(() => ({} as any));
              if (!res.ok || (j && j.ok === false)) {
                console.warn("send-push fallo", j || (await res.text()));
                pushToast("No pude enviar push (ver consola)", "error");
              }
            } catch (e) {
              console.error("Error enviando push", e);
              pushToast("No pude enviar push (error de red)", "error");
            }
          })();
        }

        prevSignRef.current[o.id] = sign;
      }
    });
  }, [prices, orders, pushSub]);

  const totalNetNow = useMemo(() => {
    return orders.reduce((sum, o) => {
      const current = prices[o.asset] || 0;
      const side = o.side ?? "SELL";
      const isSell = side === "SELL";
      const totalUsd = o.qty * o.price;

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
        const proceedsAfterSell = o.qty * current * (1 - FEE_RATE_SPOT);
        const cost = totalUsd;
        deltaUsdCloseNow = proceedsAfterSell - cost;
      }

      return sum + deltaUsdCloseNow;
    }, 0);
  }, [orders, prices]);

  const totalPctNow = useMemo(() => {
    let entryUsd = 0;
    let currentUsd = 0;

    orders.forEach((o) => {
      const current = prices[o.asset] || 0;
      if (!o.price || !current) return;

      const side = o.side ?? "SELL";
      const totalUsd = o.qty * o.price;

      if (side === "BUY") {
        entryUsd += totalUsd;
        currentUsd += o.qty * current;
      } else {
        entryUsd += totalUsd;
        currentUsd += o.qty * current;
      }
    });

    if (entryUsd <= 0) return null;
    return ((currentUsd - entryUsd) / entryUsd) * 100;
  }, [orders, prices]);

  const totalNetNowSimple = useMemo(() => {
    return orders.reduce((sum, o) => {
      const current = prices[o.asset] || 0;
      const bruto = diffVsActual(o, current);
      const feeUsd = feeCloseUsdSimple(o, current);
      return sum + (bruto - feeUsd);
    }, 0);
  }, [orders, prices]);
  void totalNetNowSimple;

  useEffect(() => {
    const positive = totalNetNow >= 0;
    const light = positive ? "🟢" : "🔴";
    const pctStr =
      typeof totalPctNow === "number"
        ? ` (${totalPctNow >= 0 ? "+" : ""}${totalPctNow.toFixed(2)}%)`
        : "";
    document.title = `${light} Neto: ${money.format(totalNetNow)}${pctStr}`;
  }, [totalNetNow, totalPctNow]);

  const first = orders[0];
  const firstCurrent = first ? prices[first.asset] || 0 : 0;
  const firstBruto = first ? diffVsActual(first, firstCurrent) : 0;
  const firstFeeUsd = first ? feeCloseUsdSimple(first, firstCurrent) : 0;
  const firstNetoSimple = first ? firstBruto - firstFeeUsd : 0;

  /* Helpers para limpiar decimales */
  const normalizeDecimal = (s: string) =>
    s.replace(/[^\d.,]/g, "").replace(/,/g, ".");
  const parseDec = (s: string) => {
    const n = Number(normalizeDecimal(s));
    return Number.isFinite(n) ? n : NaN;
  };

  const primaryOrder = pickPrimaryOrder(orders);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-8">
      <div className="w-full mx-auto grid gap-6">
        {/* Toasts */}
        <div
          className={cn(
            "fixed z-50 space-y-2",
            "inset-x-0 bottom-4 flex flex-col items-center",
            "md:inset-auto md:bottom-4 md:right-4 md:left-auto md:items-end"
          )}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "px-4 py-2 rounded-lg text-white shadow-lg max-w-[90%] sm:max-w-sm",
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
        {/* ===== RESUMEN MOBILE ===== */}
        <section className="md:hidden order-0 p-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur">
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
        {/* ===== Top bar ===== */}
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
              {loading ? "Actualizando....." : "Actualizar ahora"}
            </button>

            <button
              onClick={clearLocal}
              className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/20"
            >
              Borrar local
            </button>

            {lastUpdated && (
              <span className="text-sm text-neutral-400">
                Última: {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <Link to="/analisis" className="px-3 py-2 rounded-xl  text-white">
              Ir a Análisis
            </Link>
            <div className="flex items-center gap-2">
              <label className="text-sm text-neutral-400">Notificar cada</label>
              <input
                type="number"
                min={1}
                step={1}
                value={draftFreq}
                onChange={(e) =>
                  setDraftFreq(Math.max(1, Number(e.target.value || 1)))
                }
                className="w-20 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-right"
              />
              <span className="text-sm text-neutral-400">min</span>

              <button
                onClick={saveFrequency}
                disabled={savingFreq || draftFreq === freqMinutes}
                className={
                  "px-3 py-2 rounded-xl text-sm " +
                  (savingFreq || draftFreq === freqMinutes
                    ? "opacity-50 cursor-not-allowed bg-white/10"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white")
                }
              >
                {savingFreq ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </section>

        <section className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 grid gap-4 order-3 md:order-none">
          <div className="text-lg font-semibold">Agregar orden</div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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

            {/* Activo toma SIEMPRE el del select superior */}
            <div className="md:col-span-1">
              <div className="text-xs text-neutral-400 mb-1">Activo</div>
              <div className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full">
                <span className="font-medium">{form.asset}</span>
              </div>
            </div>

            <div>
              <div className="text-xs text-neutral-400 mb-1">Cantidad</div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="ej: 0.75"
                value={form.qty as any}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    qty: normalizeDecimal(e.target.value),
                  }))
                }
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
                autoComplete="off"
                pattern="[0-9]*"
              />
            </div>

            <div>
              <div className="text-xs text-neutral-400 mb-1">Precio USD</div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="ej: 2200"
                value={form.price as any}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    price: normalizeDecimal(e.target.value),
                  }))
                }
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 w-full"
                autoComplete="off"
                pattern="[0-9]*"
              />
            </div>

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
        {/* ===== Tabla de órdenes ===== */}
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

                  const diff = diffVsActual(o, current);

                  const pct = pctDiffVsEntry(o, current);
                  const pctStr =
                    pct == null
                      ? "—"
                      : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

                  let feeCloseUsd = 0;
                  if (isSell) {
                    if (current > 0) {
                      const baseRebuyGross = totalUsd / current;
                      const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT;
                      feeCloseUsd = feeBuyBase * current;
                    }
                  } else {
                    feeCloseUsd = o.qty * current * FEE_RATE_SPOT;
                  }

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

                  const breakEven = isSell
                    ? o.price * (1 - FEE_RATE_SPOT)
                    : o.price / (1 - FEE_RATE_SPOT);

                  let usdtLeftoverCloseNow = 0;
                  if (!isSell) {
                    const proceedsAfterSell =
                      o.qty * current * (1 - FEE_RATE_SPOT);
                    const cost = totalUsd;
                    usdtLeftoverCloseNow = proceedsAfterSell - cost;
                  }

                  let ethTargetRebuyAll: number | null = null;
                  let ethTargetDelta: number | null = null;
                  if (isSell && current > 0) {
                    const baseRebuyGross = totalUsd / current;
                    const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT;
                    const baseRebuyNet = baseRebuyGross - feeBuyBase;
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
        {/* Arriba: Veredicto + Rangos (dos columnas en desktop) */}
        <div className="grid gap-6 md:grid-cols-2 items-start">
          <div className="h-full">
            <EthVerdict data={ethAnalysis} />

            {/* Abajo: Intradía & 1 día (full width) */}
            <EthIntraday
              data={ethAnalysis}
              loading={ethLoading}
              error={ethError}
            />
            <NewsSentimentSummary
              asset={form.asset}
              orderSide={primaryOrder?.side}
              refreshKey={ethRefreshKey} // tu gatillo de 10 min
            />
          </div>
          <div className="h-full">
            <AssetRanges
              asset={form.asset}
              price={prices[form.asset] || 0}
              refreshKey={ethRefreshKey} // tu clave de refresh cada 10 min
              orderType={primaryOrder?.side ?? form.side}
            />
            <DropLadderSimulator
              asset={form.asset}
              currentPrice={prices[form.asset] || 0}
              defaultQty={6}
              step={100}
              rows={12}
            />
            <RebuySimulator
              asset={form.asset}
              currentPrice={prices[form.asset] || 0}
              defaultQty={6}
              step={100}
              rows={12}
            />

            <MarketBiasAnalyzer
              asset={form.asset} // "ETH", "BTC", etc.
              interval="1h"
              limit={300}
              refreshMs={60000}
            />

            <MarketHoursSummary
              asset={form.asset}
              symbol={`${form.asset.toUpperCase()}USDT`}
              orderSide={primaryOrder?.side} // 👉 prioriza subas (BUY) o bajas (SELL)
              refreshKey={ethRefreshKey} // 👉 se recalcula cada 10 min si ya usás esta key
            />
          </div>
        </div>
      </div>{" "}
    </div>
  );
}
