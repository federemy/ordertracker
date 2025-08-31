// src/push.ts
export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready; // activo
    return reg;
  } catch (e) {
    console.error("SW register error", e);
    return null;
  }
}

export async function subscribePush(reg: ServiceWorkerRegistration) {
  if (!("PushManager" in window) || !reg.pushManager) return null;

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  if (!publicKey) throw new Error("Falta VITE_VAPID_PUBLIC_KEY");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permiso de notificación denegado");

  const urlBase64ToUint8Array = (base64: string) => {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  // Guardar en backend
  const res = await fetch("/.netlify/functions/save-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!res.ok) {
    throw new Error(`save-subscription fail: ${await res.text()}`);
  }
  return sub;
}

export async function testPush(
  title = "🔔 Test push",
  body = "Hola desde el backend!"
) {
  const res = await fetch("/.netlify/functions/send-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error(`send-push fail: ${await res.text()}`);
  return res.json();
}
