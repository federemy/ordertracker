import type { Handler } from "@netlify/functions";
import { getStore } from "./_store";

type PushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

type SubscriptionsDB = {
  list: PushSubscription[];
};

const SUBS_FALLBACK: SubscriptionsDB = { list: [] };

export async function getSubscriptions(): Promise<PushSubscription[]> {
  const store = await getStore<SubscriptionsDB>("subscriptions", SUBS_FALLBACK);
  const db = await store.read();
  return db.list;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}") as PushSubscription;
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return { statusCode: 400, body: "Invalid subscription" };
    }

    const store = await getStore<SubscriptionsDB>(
      "subscriptions",
      SUBS_FALLBACK
    );
    const db = await store.read();

    // dedupe por endpoint
    const exists = db.list.find((s) => s.endpoint === body.endpoint);
    if (!exists) {
      db.list.push(body);
      await store.write(db);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "save-subscription error" };
  }
};
