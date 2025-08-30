export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.register("/sw.js");
}

export async function subscribeUserToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push no soportado");
  }

  const reg = await registerServiceWorker();
  if (!reg) throw new Error("No se pudo registrar el Service Worker");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permiso denegado");

  const publicKey =
    import.meta.env.PUBLIC_VAPID_KEY || (window as any).PUBLIC_VAPID_KEY;
  const vapidKey = urlBase64ToUint8Array(publicKey);

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey,
  });

  // enviar la suscripción al backend
  await fetch("/.netlify/functions/save-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  return sub;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}
