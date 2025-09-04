/* sw.js — Service Worker para Push & Click-through */
self.addEventListener('install', (event) => {
  // Activar inmediatamente en la primera carga
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Tomar control de las pestañas abiertas
  event.waitUntil(self.clients.claim());
});

// Muestra notificaciones incluso con la app cerrada
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    // Si no vino JSON, intentar como texto
    data = { title: '🔔 Notificación', body: event.data?.text() || '' };
  }

  const title = data.title || '🔔 Notificación';
  const body = data.body || 'Tocá para abrir';
  const url = data.url || (data.data && data.data.url) || '/';

  const options = {
    body,
    // Reemplazá por tus rutas a íconos reales si querés
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'push-default',
    renotify: !!data.renotify,
    requireInteraction: false, // Android lo ignora; lo dejo explícito
    data: { url },
    actions: [
      { action: 'open', title: 'Abrir' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación, abrir/enfocar la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si ya hay una pestaña con ese URL, enfocarla
    for (const client of allClients) {
      try {
        const u = new URL(client.url);
        if (u.pathname === new URL(targetUrl, self.location.origin).pathname) {
          return client.focus();
        }
      } catch { }
    }
    // Si no, abrir nueva
    return self.clients.openWindow(targetUrl);
  })());
});

// (Opcional) manejar cambios de suscripción si el browser rota la key
self.addEventListener('pushsubscriptionchange', async (event) => {
  // Podés re-suscribirte acá y avisar a tu backend
  // const appServerKey = ...;
  // const newSub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
  // await fetch('/.netlify/functions/save-subscription', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newSub) });
});
