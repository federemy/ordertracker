import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getSubscriptions } from "./save-subscription";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;

webpush.setVapidDetails(
  "mailto:you@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

type SendResult = { endpoint: string; ok: boolean; error?: string };

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { title, body, subscription } = JSON.parse(event.body || "{}");

  // si vino una suscripción puntual, la uso directamente (modo test)
  if (subscription) {
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title, body })
      );
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (e: any) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: String(e?.message || e) }),
      };
    }
  }

  // si no, envío a todas las guardadas
  const subs = await getSubscriptions();
  if (!subs.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        note: "No hay suscripciones guardadas",
      }),
    };
  }

  const payload = { title: title || "Ping", body: body || "Hola 👋" };
  const results: SendResult[] = [];

  for (const sub of subs as any[]) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      results.push({ endpoint: sub?.endpoint, ok: true });
    } catch (e: any) {
      results.push({
        endpoint: sub?.endpoint,
        ok: false,
        error: String(e?.message || e),
      });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, results }) };
};
