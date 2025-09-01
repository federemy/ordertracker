import type { Handler } from "@netlify/functions";
import { getList } from "./_store"; // usa el _store que te pasé

const STORE = "subs";
const KEY = "list";

const handler: Handler = async () => {
  try {
    const subs = (await getList<any[]>(STORE, KEY)) || [];
    const masked = subs.map((s) => ({
      endpointPreview: String(s.endpoint).slice(0, 45) + "...",
      hasKeys: !!(s.keys?.p256dh && s.keys?.auth),
    }));
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: subs.length, subs: masked }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "debug-subs error" };
  }
};

export { handler };
