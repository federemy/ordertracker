// sw.js
const BADGE = "/icons/badge-72.png";
const ICON = "/icons/app-192.png";
const STATE_CACHE = "app-state-v1";
const STATE_KEY = "/__primary-order";

let primaryOrder = null;

async function setPrimaryOrder(order) {
  primaryOrder = order || null;
  const cache = await caches.open(STATE_CACHE);
  await cache.put(
    STATE_KEY,
    new Response(JSON.stringify(primaryOrder), {
      headers: { "content-type": "application/json" },
    })
  );
}

async function getPrimaryOrder() {
  if (primaryOrder) return primaryOrder;
  const cache = await caches.open(STATE_CACHE);
  const res = await cache.match(STATE_KEY);
  if (!res) return null;
  try { primaryOrder = await res.json(); } catch { primaryOrder = null; }
  return primaryOrder;
}

self.addEventListener("message", (e) => {
  if (e.data?.type === "SET_PRIMARY_ORDER") {
    e.waitUntil(setPrimaryOrder(e.data.order || null));
  }
});

// --- helpers de cálculo (igual que antes) ---
function feeCloseUsdSimple(o, current) {
  const FEE = 0.0015;
  return (o.side || "SELL") === "SELL"
    ? ((o.qty * o.price) / current) * FEE * current
    : o.qty * current * FEE;
}
function diffBruto(o, current) {
  const side = o.side || "SELL";
  return side === "SELL" ? (o.price - current) * o.qty : (current - o.price) * o.qty;
}
function pctVsEntry(o, current) {
  const side = o.side || "SELL";
  if (!o.price || current <= 0) return 0;
  const raw = side === "SELL" ? (o.price - current) / o.price : (current - o.price) / o.price;
  return raw * 100;
}
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

// --- push: SIEMPRE lee la orden desde cache (fuente de verdad) ---
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { }
    const price = Number(data.price);

    const order = await getPrimaryOrder(); // 👈 evita orden vieja en RAM

    let title = data.title || "ETH";
    let body = data.body || "";

    if (order && Number.isFinite(price) && price > 0) {
      const bruto = diffBruto(order, price);
      const fee = feeCloseUsdSimple(order, price);
      const neto = bruto - fee;
      const pct = pctVsEntry(order, price);
      title = `ETH ${money(price)}`;
      body = `Δ neta: ${neto >= 0 ? "+" : "−"}${money(Math.abs(neto))} `
        + `(${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%) · `
        + `Qty: ${order.qty.toFixed(6)} · Orden: ${money(order.price)}`;
    }

    return self.registration.showNotification(title, {
      body,
      icon: data.icon || ICON,
      badge: data.badge || BADGE,
      data: { url: data.url || "/" },
      tag: data.tag || "eth-30m",
      renotify: false
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const hit = list.find(c => c.url.includes(url));
    return hit ? hit.focus() : clients.openWindow(url);
  })());
});
