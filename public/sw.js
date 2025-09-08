/* sw.js */

const BADGE = "/icons/badge-72.png";
const ICON = "/icons/app-192.png";

let primaryOrder = null; // { asset, qty, price, side }

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SET_PRIMARY_ORDER") {
    primaryOrder = data.order || null;
    // opcional: persistir en IDB si querés sobrevivir a restarts
  }
});

function feeCloseUsdSimple(o, current) {
  const FEE_RATE_SPOT = 0.0015; // 0.15%
  if (!o || !current) return 0;
  const isSell = (o.side || "SELL") === "SELL";
  if (isSell) {
    const totalUsd = o.qty * o.price;
    const baseRebuyGross = totalUsd / current;
    const feeBuyBase = baseRebuyGross * FEE_RATE_SPOT;
    return feeBuyBase * current;
  } else {
    return o.qty * current * FEE_RATE_SPOT;
  }
}

function diffVsActual(o, current) {
  const side = o.side || "SELL";
  return side === "SELL"
    ? (o.price - current) * o.qty
    : (current - o.price) * o.qty;
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { }

  const price = Number(data.price);
  let title = data.title || "ETH";
  let body = data.body || "";

  if (primaryOrder && Number.isFinite(price) && price > 0) {
    const bruto = diffVsActual(primaryOrder, price);
    const fee = feeCloseUsdSimple(primaryOrder, price);
    const neto = bruto - fee;

    const money = (n) => {
      try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n); }
      catch { return `$${(Math.round(n * 100) / 100).toFixed(2)}`; }
    };

    title = `ETH ${money(price)}`;
    body = `Δ neta: ${(neto >= 0 ? "+" : "−")}${money(Math.abs(neto))} · Qty: ${primaryOrder.qty} · Orden: ${money(primaryOrder.price)}`;
  }

  const options = {
    body,
    icon: data.icon || ICON,
    badge: data.badge || BADGE,
    data: { url: data.url || "/" },
    tag: data.tag || "push",
    renotify: !!data.renotify,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })()
  );
});
