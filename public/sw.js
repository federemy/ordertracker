self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const title = data.title || "🔔 Notificación";
  const body = data.body || "";
  const icon = "/icon-192.png"; // poné un icono real si querés
  const badge = "/icon-96.png";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      vibrate: [200, 100, 200],
      tag: "criptorder",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow("/") // abre tu app al clickear
  );
});
