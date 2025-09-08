import type { Handler } from "@netlify/functions";
import webPush from "web-push";
import { getList } from "./_store";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.CONTACT_EMAIL || "mailto:you@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };
type Body = { title?: string; body?: string; url?: string; subscription?: Sub };

const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error: "Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY",
        }),
      };
    }

    const payload = (event.body ? JSON.parse(event.body) : {}) as Body;
    const { title = "Ping", body = "", url = "/", subscription } = payload;
    const message = JSON.stringify({ title, body, url });

    // 1) Envío directo (sin Blobs) si viene la 'subscription'
    if (subscription?.endpoint) {
      try {
        await webPush.sendNotification(subscription as any, message, {
          TTL: 300,
        }); // ⬅️ TTL explícito
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true, sent: 1, note: "direct" }),
        };
      } catch (e: any) {
        const code = e?.statusCode;
        const msg = e?.body || e?.message || String(e);
        return {
          statusCode: 500,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: false, error: msg, code, note: "direct" }),
        };
      }
    }

    // 2) Caso Blobs (subs/list)
    let subs: Sub[] = [];
    try {
      subs = ((await getList<Sub[]>("subs", "list")) || []).filter(
        (s) => !!s?.endpoint
      );
    } catch (e: any) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error:
            "No hay 'subscription' en el body y Blobs no está disponible. " +
            "Enviá { subscription } en el POST o configurá NETLIFY_BLOBS_*.",
        }),
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
    const errors: any[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webPush.sendNotification(s as any, message, { TTL: 300 }); // ⬅️ TTL explícito
          sent++;
        } catch (e: any) {
          errors.push({
            endpoint: s.endpoint,
            code: e?.statusCode,
            error: e?.body || e?.message || String(e),
          });
        }
      })
    );

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, sent, errors }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};

export default handler;
