// src/components/PushControls.tsx
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
  const [active, setActive] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setActive(!!sub);
    setEndpoint(sub?.endpoint ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      console.log("[SW] registrado:", reg.scope);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", (e) => {
          console.log("[SW message]", e.data);
        });
      }
      await refresh();
    })();
  }, [refresh]);

  const mySub = async () => {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  };

  const enable = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return alert("Permiso denegado");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      // guardar en server
      await fetch("/.netlify/functions/save-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      await refresh();
      alert("Activado ✅");
    } catch (e: any) {
      alert("Falló activar");
      console.error(e);
    }
  };

  const disable = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) {
        await refresh();
        return;
      }
      const ep = sub.endpoint;
      await sub.unsubscribe();
      await fetch("/.netlify/functions/save-subscription?remove=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: ep }),
      });
      await refresh();
      alert("Desactivado");
    } catch (e: any) {
      alert("Falló desactivar");
      console.error(e);
    }
  };

  // === Botones “sin consola” ===
  const showMyEndpoint = async () => {
    const s = await mySub();
    const ep = s?.endpoint || null;
    setMine(ep);
    alert(ep ? ep : "Sin suscripción");
  };

  const saveMySubscription = async () => {
    const s = await mySub();
    if (!s) return alert("Sin suscripción");
    const r = await fetch("/.netlify/functions/save-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    alert(r.ok ? "Guardada en servidor ✅" : "Error guardando");
    await refresh();
  };

  const sendOnlyToThisDevice = async () => {
    const s = await mySub();
    if (!s) return alert("Sin suscripción");
    const r = await fetch("/.netlify/functions/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test a este dispositivo",
        body: "Hola 👋",
        url: "/",
        subscription: s, // << envío directo sin depender de Blobs
      }),
    });
    alert(r.ok ? "Enviado ✅" : "Error enviando");
  };

  const removeOtherEndpoints = async () => {
    const s = await mySub();
    const myEp = s?.endpoint;
    const resp = await fetch("/.netlify/functions/list-subs");
    const j = await resp.json().catch(() => ({}));
    const others: string[] = (j.list || [])
      .map((x: any) => x.endpoint)
      .filter((ep: string) => ep !== myEp);
    let removed = 0;
    for (const ep of others) {
      const r = await fetch("/.netlify/functions/save-subscription?remove=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: ep }),
      });
      if (r.ok) removed++;
    }
    await refresh();
    alert(`Borrados ${removed} endpoints`);
  };

  const pingCronNow = async () => {
    // dispara la función programada en modo debug, para no esperar
    const r = await fetch("/.netlify/functions/cron-30m?debug=1");
    const txt = await r.text();
    alert(r.ok ? "Cron OK (debug)" : "Cron error");
    console.log("cron-30m?debug=1 →", txt);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <b>Estado:</b> {active ? "activado ✅" : "inactivo"}
        <br />
        {endpoint && (
          <small style={{ opacity: 0.7 }}>endpoint actual: {endpoint}</small>
        )}
        {mine && (
          <div style={{ opacity: 0.7, marginTop: 4 }}>
            <small>MI endpoint: {mine}</small>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={enable} disabled={active}>
          Activar
        </button>
        <button onClick={disable} disabled={!active}>
          Desactivar
        </button>
        <button onClick={showMyEndpoint} disabled={!active}>
          Mi endpoint
        </button>
        <button onClick={saveMySubscription} disabled={!active}>
          Guardar MI sub
        </button>
        <button onClick={sendOnlyToThisDevice} disabled={!active}>
          Enviar a ESTE
        </button>
        <button onClick={removeOtherEndpoints} disabled={!active}>
          Borrar otros
        </button>
        <button onClick={pingCronNow}>Probar cron (debug)</button>
      </div>
    </div>
  );
}
