import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getList, setList } from "./_store";

const STORE = "subs";
const KEY = "list";

const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;

if (PUB && PRIV) {
  webpush.setVapidDetails("mailto:you@example.com", PUB, PRIV);
}

type Body = { title?: string; body?: string; url?: string; subscription?: any };

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };
  try {
    if (!PUB || !PRIV) return { statusCode: 500, body: "Missing VAPID keys" };

    const data: Body = event.body ? JSON.parse(event.body) : {};
    const payload = JSON.stringify({
      title: data.title || "🔔 Notificación",
      body: data.body || "Tocá para abrir",
      url: data.url || "/",
    });

    let targets: any[] = data.subscription
      ? [data.subscription]
      : (await getList<any[]>(STORE, KEY)) || [];
    if (!targets.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, note: "no subs" }),
      };
    }

    let sent = 0;
    const stillValid: any[] = [];
    const results: any[] = [];

    for (const sub of targets) {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
        stillValid.push(sub);
        results.push({
          endpointPreview: String(sub.endpoint).slice(0, 45) + "...",
          ok: true,
        });
      } catch (e: any) {
        const code = e?.statusCode || e?.code;
        const msg = e?.message || String(e);
        results.push({
          endpointPreview: String(sub.endpoint).slice(0, 45) + "...",
          ok: false,
          code,
          msg,
        });
        // 404/410 => baja
        if (code !== 404 && code !== 410) stillValid.push(sub);
      }
    }

    if (!data.subscription) await setList(STORE, KEY, stillValid);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, sent, results }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "send-push error" };
  }
};

export { handler };
