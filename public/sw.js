self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { }
  const title = data.title || "Noti";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/app-192.png",
    badge: data.badge || "/icons/badge-72.png",
    data: { url: data.url || "/" },
    tag: data.tag || "push",
    renotify: !!data.renotify,
  };
  event.waitUntil(
    (async () => {
      // mostrar notificación
      await self.registration.showNotification(title, options);
      // avisar a las páginas abiertas para que lo veas en Android
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        c.postMessage({ type: "PUSH_EVENT", receivedAt: Date.now(), payload: data });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.includes(new URL(url, self.location.origin).pathname)) {
          c.postMessage({ type: "NOTIFICATION_CLICK", at: Date.now(), url });
          return c.focus();
        }
      }
      const win = await clients.openWindow(url);
      if (win) win.postMessage({ type: "NOTIFICATION_CLICK", at: Date.now(), url });
    })()
  );
});
