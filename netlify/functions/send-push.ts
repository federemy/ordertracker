import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getSubscriptions } from "./save-subscription";

// Lee VAPID desde env (Netlify Dev carga .env automáticamente)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn(
    "⚠️ VAPID keys faltan en env. Configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY."
  );
}

webpush.setVapidDetails(
  "mailto:push@yourdomain.com",
  VAPID_PUBLIC_KEY || "missing",
  VAPID_PRIVATE_KEY || "missing"
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { title = "Test", body = "Hola 👋" } = JSON.parse(event.body || "{}");

    const subs = await getSubscriptions();
    if (!subs.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0 }) };
    }

    const payload = JSON.stringify({ title, body });

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(s, payload, {
          TTL: 30,
        })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sent, failed }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "send-push error" };
  }
};
