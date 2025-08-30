import type { Handler } from "@netlify/functions";
import webpush from "web-push";

const SUBS_KEY = "subs.json";

function assertVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set");
  }
  webpush.setVapidDetails("mailto:you@example.com", pub, priv);
}

export const handler: Handler = async (event, context) => {
  try {
    assertVapid();

    // Blobs
    const blobs: any =
      // @ts-ignore
      context?.blob || (globalThis as any).netlify?.blobs;

    // Cargar suscripciones
    const r = await blobs.get(SUBS_KEY);
    const subs: any[] = r ? JSON.parse(await r.text()) : [];
    if (!subs.length) {
      return { statusCode: 200, body: "no subscriptions" };
    }

    // Mensaje (permite GET para test rápido)
    let title = "🔔 Test";
    let body = "Push enviado desde send-push";
    if (event.httpMethod === "POST" && event.body) {
      const b = JSON.parse(event.body);
      if (b?.title) title = String(b.title);
      if (b?.body) body = String(b.body);
    } else if (event.httpMethod === "GET") {
      title = "🔔 Test (GET)";
      body = "Función viva ✅";
    }

    const payload = JSON.stringify({ title, body });

    let ok = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(s, payload);
        ok++;
      } catch {
        // ignoramos fallos individuales (tokens viejos)
      }
    }

    return { statusCode: 200, body: `sent=${ok}` };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: String(e?.message || e),
      }),
    };
  }
};
