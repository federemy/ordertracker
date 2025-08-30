import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getSubscriptions } from "./save-subscription";

const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;

if (!PUB || !PRIV) {
  console.error("❌ Falta VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY en env");
}

webpush.setVapidDetails("mailto:tu@mail.com", PUB!, PRIV!);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { title = "🔔 Notificación", body = "Mensaje vacío" } = JSON.parse(
    event.body || "{}"
  );

  const subs = getSubscriptions();
  if (!subs.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, msg: "No hay subs" }),
    };
  }

  const results: any[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body }));
      results.push({ endpoint: sub.endpoint, ok: true });
    } catch (err) {
      console.error("send-push error", err);
      results.push({ endpoint: sub.endpoint, ok: false, error: String(err) });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, results }),
  };
};
