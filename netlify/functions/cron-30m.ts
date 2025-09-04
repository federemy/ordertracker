// netlify/functions/cron-30m.ts
import type { Handler } from "@netlify/functions";
import webPush from "web-push";
import { getList, setList } from "./_store";

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = "mailto:you@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("[cron-30m] Missing VAPID keys");
}

export const handler: Handler = async (event) => {
  try {
    // Permite probar manualmente con ?debug=1
    const debug = event.queryStringParameters?.debug === "1";

    // 1) Cargar subs de Blobs
    const subs: Sub[] = ((await getList<Sub[]>("subs", "list")) || []).filter(
      (s) => !!s?.endpoint
    );

    if (!subs.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, note: "no-subs" }),
      };
    }

    // 2) Payload (puede incluir URL para abrir tu app)
    const payload = JSON.stringify({
      title: "🔔 Actualización programada",
      body: debug
        ? "Test manual desde cron-30m ✅"
        : "Ping programado (cada 30 min) ✅",
      url: "/", // cambia si querés abrir otra ruta
      tag: "heartbeat-30m",
      renotify: false,
    });

    // 3) Enviar a todos y filtrar inválidos (404/410)
    const stillValid: Sub[] = [];
    let sent = 0;

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webPush.sendNotification(s as any, payload);
          stillValid.push(s);
          sent++;
        } catch (e: any) {
          const code = e?.statusCode;
          if (code !== 404 && code !== 410) {
            stillValid.push(s); // error transitorio → mantener
          }
        }
      })
    );

    // 4) Persistir la lista depurada
    if (stillValid.length !== subs.length) {
      await setList("subs", "list", stillValid);
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, sent }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `cron-30m error: ${e?.message || e}` };
  }
};
