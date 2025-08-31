/* public/sw.js */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { }

  const title = data.title || "Notificación";
  const body = data.body || "";
  const icon = "/icon-192.png"; // Asegúrate de tener estos íconos
  const badge = "/icon-192.png";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag: "orders-push",
      renotify: true,
      data,
      requireInteraction: false
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = self.location.origin + "/";
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = allClients.find((c) => c.url === url);
    if (client) client.focus();
    else self.clients.openWindow(url);
  })());
});
