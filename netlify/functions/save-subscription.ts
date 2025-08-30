import type { Handler } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const SUBS_KEY = "subs";
type Sub = any;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const sub = JSON.parse(event.body || "{}") as Sub;
    const store = getStore({ name: "push-subs" }); // bucket Blobs
    const raw = (await store.get(SUBS_KEY)) || "[]";
    const list: Sub[] = JSON.parse(raw);
    // evitar duplicados por endpoint
    const exists = list.some((s) => s?.endpoint === sub?.endpoint);
    if (!exists) {
      list.push(sub);
      await store.set(SUBS_KEY, JSON.stringify(list));
    }
    return { statusCode: 200, body: "OK" };
  } catch (e: any) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};
