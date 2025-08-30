import type { Handler } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const SUBS_KEY = "subs";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC!;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:you@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { title, body } = JSON.parse(event.body || "{}");
    const store = getStore({ name: "push-subs" });
    const raw = (await store.get(SUBS_KEY)) || "[]";
    const subs: any[] = JSON.parse(raw);

    if (!subs.length) {
      return { statusCode: 200, body: "No hay suscripciones" };
    }

    const payload = JSON.stringify({
      title: title || "🔔 Test de notificación",
      body: body || "Si ves esto, las push funcionan 👌",
      url: "/", // adonde abre al tocar la noti
    });

    // Enviar a todas (ignoramos errores de endpoints caducados)
    await Promise.allSettled(
      subs.map((s) => webpush.sendNotification(s, payload))
    );

    return { statusCode: 200, body: "Enviado" };
  } catch (e: any) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};
