import { useCallback, useEffect, useState } from "react";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushControls() {
  const [active, setActive] = useState<boolean>(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setActive(!!sub);
    setEndpoint(sub?.endpoint ?? null);
    console.log(
      "[refresh] subscription",
      sub ? { endpoint: sub.endpoint } : null
    );
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (e) => {
        console.log("[SW message]", e.data);
      });
    }
    (async () => {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      console.log("[SW] registrado:", reg.scope);
      await refresh();
    })();
  }, [refresh]);

  const enable = async () => {
    try {
      console.log("--- ENABLE: pedir permiso ---");
      const perm = await Notification.requestPermission();
      console.log("Notification.permission →", perm);
      if (perm !== "granted") return console.warn("permiso no concedido");

      if (!VAPID_PUBLIC)
        console.warn("VAPID_PUBLIC vacío (VITE_VAPID_PUBLIC_KEY)");
      else console.log("VAPID_PUBLIC length:", VAPID_PUBLIC.length);

      console.log("--- ENABLE: subscribe() ---");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      console.log("subscribe() OK endpoint:", sub.endpoint);

      console.log("--- GUARDAR en save-subscription ---");
      const resp = await fetch("/.netlify/functions/save-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      console.log("save-subscription →", resp.status, resp.statusText);
      const json = await resp.json().catch(() => null);
      console.log("save-subscription body:", json);

      await refresh();
      alert("Activado ✅");
    } catch (e: any) {
      console.error("ENABLE error", e?.name, e?.message || e);
      alert("Falló activar (mirá los logs)");
    }
  };

  const disable = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) {
        console.warn("no hay suscripción");
        await refresh();
        return;
      }
      const endpoint = sub.endpoint;

      console.log("--- UNSUBSCRIBE local ---");
      await sub.unsubscribe();

      console.log("--- UNSUBSCRIBE remoto (save-subscription?remove=1) ---");
      const resp = await fetch(
        "/.netlify/functions/save-subscription?remove=1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }
      );
      console.log("remove →", resp.status, resp.statusText);
      const body = await resp.json().catch(() => null);
      console.log("remove body:", body);

      await refresh();
      alert("Desactivado");
    } catch (e: any) {
      console.error("DISABLE error", e?.name, e?.message || e);
      alert("Falló desactivar (mirá los logs)");
    }
  };

  const testPush = async () => {
    try {
      console.log("--- TEST: send-push ---");
      const resp = await fetch("/.netlify/functions/send-push", {
        method: "POST",
      });
      console.log("send-push →", resp.status, resp.statusText);
      const text = await resp.text();
      console.log("send-push body:", text);
      if (!resp.ok) alert("send-push devolvió error (mirá logs)");
    } catch (e: any) {
      console.error("TEST error", e?.name, e?.message || e);
      alert("Error llamando a send-push");
    }
  };

  const listSubs = async () => {
    try {
      const resp = await fetch("/.netlify/functions/list-subs");
      console.log("list-subs →", resp.status, resp.statusText);
      const body = await resp.text();
      console.log("list-subs body:", body);
    } catch (e: any) {
      console.error("list-subs error", e?.name, e?.message || e);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <b>Estado:</b> {active ? "activado ✅" : "inactivo"}
        <br />
        {endpoint && (
          <small style={{ opacity: 0.7 }}>endpoint: {endpoint}</small>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={enable} disabled={active}>
          Activar
        </button>
        <button onClick={testPush} disabled={!active}>
          Probar push
        </button>
        <button onClick={disable} disabled={!active}>
          Desactivar
        </button>
        <button onClick={listSubs}>Listar subs</button>
      </div>
    </div>
  );
}
