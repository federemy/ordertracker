import { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getStore } from "@netlify/blobs";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;

webpush.setVapidDetails(
  "mailto:test@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

async function getSubscriptions() {
  const store = getStore({ name: "subs" });
  const list = (await store.get("list", { type: "json" })) || [];
  return Array.isArray(list) ? list : [];
}

export const handler: Handler = async (event) => {
  try {
    const debug = event.queryStringParameters?.debug === "1";

    const subs = await getSubscriptions();
    console.log(`[cron-check] subs: ${subs.length}`);

    if (!subs.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, reason: "no-subs" }),
      };
    }

    // “Heartbeat” cada ejecución (o manual con ?debug=1)
    const payload = JSON.stringify({
      title: "🔔 CriptOrder",
      body: debug
        ? "Test manual desde cron-check ✅"
        : "Ping programado (cada 30 min) ✅",
      // Opcional: data para abrir una URL
      data: { url: "/" },
    });

    let sent = 0;
    await Promise.all(
      subs.map(async (s: any) => {
        try {
          await webpush.sendNotification(s, payload);
          sent++;
        } catch (err) {
          console.error("[cron-check] push error", err);
        }
      })
    );

    console.log(`[cron-check] sent=${sent}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch (e) {
    console.error("[cron-check] fatal", e);
    return { statusCode: 500, body: String(e) };
  }
};
