// src/components/PushControls.tsx
import { useCallback, useEffect, useState } from "react";

export default function PushControls() {
  const [active, setActive] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [mine] = useState<string | null>(null);

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

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <b>Estado:</b> {active ? "activado ✅" : "inactivo"}
        <br />
        {endpoint && <small style={{ opacity: 0.7 }}></small>}
        {mine && (
          <div style={{ opacity: 0.7, marginTop: 4 }}>
            <small>MI endpoint: {mine}</small>
          </div>
        )}
      </div>
    </div>
  );
}
