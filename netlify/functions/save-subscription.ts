import type { Handler } from "@netlify/functions";

const SUBS_KEY = "subs";
type Sub = any;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  const body = JSON.parse(event.body || "{}");
  const subs = await getSubscriptions();
  subs.push(body);
  await saveSubscriptions(subs);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

// helpers simples usando KV de Netlify o filesystem (mock)
async function loadJSON<T>(key: string): Promise<T | null> {
  // si usás Netlify Blobs:
  // @ts-ignore
  const blob = await import("@netlify/blobs");
  const s = await blob.get(key);
  return s ? (JSON.parse(s) as T) : null;
}
async function saveJSON<T>(key: string, value: T) {
  // @ts-ignore
  const blob = await import("@netlify/blobs");
  await blob.set(key, JSON.stringify(value));
}

export async function getSubscriptions(): Promise<Sub[]> {
  return (await loadJSON<Sub[]>(SUBS_KEY)) ?? [];
}
async function saveSubscriptions(subs: Sub[]) {
  await saveJSON(SUBS_KEY, subs);
}
