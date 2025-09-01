import type { Handler } from "@netlify/functions";
import { getList, setList } from "./_store";

type PushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

const STORE = "subs";
const KEY = "list";

export const getSubscriptions = async (): Promise<PushSubscription[]> => {
  const list = await getList<PushSubscription[]>(STORE, KEY);
  return Array.isArray(list) ? list : [];
};

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    if (!event.body) return { statusCode: 400, body: "Missing body" };

    const body = JSON.parse(event.body) as PushSubscription;
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return { statusCode: 400, body: "Invalid subscription" };
    }

    const current = await getSubscriptions();
    const exists = current.some((s) => s.endpoint === body.endpoint);
    const next = exists ? current : [...current, body];

    await setList(STORE, KEY, next);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, total: next.length }),
    };
  } catch (e: any) {
    console.error("save-subscription error", e);
    return { statusCode: 500, body: e?.message || "save-subscription error" };
  }
};

export { handler };
