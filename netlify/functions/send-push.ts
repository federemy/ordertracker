// netlify/functions/send-push.ts
import type { Handler } from "@netlify/functions";
import webPush from "web-push";
import { getList } from "./_store"; // usa tu _store actual (o el de Opción B)

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type Sub = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
};
type Body = {
  title?: string;
  body?: string;
  url?: string;
  subscription?: Sub; // 👈 hotfix: enviar directo a esta sub
};

const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    const payload = (event.body ? JSON.parse(event.body) : {}) as Body;
    const { title = "Ping", body = "", url = "/", subscription } = payload;

    const message = JSON.stringify({ title, body, url });

    // 1) Si viene una sub en el body, usarla y listo (sin Blobs)
    if (subscription?.endpoint) {
      await webPush.sendNotification(subscription as any, message);
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, sent: 1, note: "direct" }),
      };
    }

    // 2) Si no vino una sub, intentar leer del store (subs/list)
    let subs: Sub[] = [];
    try {
      subs = ((await getList<Sub[]>("subs", "list")) || []).filter(
        (s) => !!s?.endpoint
      );
    } catch (e: any) {
      // No hay Blobs configurado → mensaje claro
      return {
        statusCode: 500,
        body:
          "No hay suscripción en el body y Blobs no está configurado. " +
          "Enviá { subscription } en el POST o configurá Blobs (siteID/token).",
      };
    }

    if (!subs.length) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, sent: 0, note: "no subs" }),
      };
    }

    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webPush.sendNotification(s as any, message);
          sent++;
        } catch {}
      })
    );

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, sent }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: `send-push error: ${e?.message || e}`,
    };
  }
};

export default handler;
