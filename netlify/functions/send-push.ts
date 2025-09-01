import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getList, setList } from "./_store";

const STORE = "subs";
const KEY = "list";

const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;

if (!PUB || !PRIV) {
  console.warn(
    "⚠️ Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (definilas en .env para netlify dev y en el panel para prod)"
  );
}

if (PUB && PRIV) {
  webpush.setVapidDetails("mailto:you@example.com", PUB, PRIV);
}

type Body = {
  title?: string;
  body?: string;
  url?: string;
  subscription?: any;
};

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (!PUB || !PRIV) {
      return { statusCode: 500, body: "Missing VAPID keys" };
    }

    const data: Body = event.body ? JSON.parse(event.body) : {};
    const payload = JSON.stringify({
      title: data.title || "🔔 Notificación",
      body: data.body || "Tocá para abrir",
      url: data.url || "/",
    });

    let targets: any[] = [];
    if (data.subscription) {
      targets = [data.subscription];
    } else {
      targets = (await getList<any[]>(STORE, KEY)) || [];
    }

    if (!targets.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, note: "no subs" }),
      };
    }

    let sent = 0;
    const stillValid: any[] = [];

    for (const sub of targets) {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
        stillValid.push(sub);
      } catch (e: any) {
        const code = e?.statusCode || e?.code;
        console.warn("send-push to one sub failed:", code, e?.message);
        if (code !== 404 && code !== 410) {
          stillValid.push(sub);
        }
      }
    }

    if (!data.subscription) {
      await setList(STORE, KEY, stillValid);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch (e: any) {
    console.error("send-push error", e);
    return { statusCode: 500, body: e?.message || "send-push error" };
  }
};

export { handler };
