import type { Handler } from "@netlify/functions";

const SUBS_KEY = "subs.json";

export const handler: Handler = async (event, ctx) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "POST only" };
  const sub = JSON.parse(event.body || "{}");

  // @ts-ignore
  const blob = ctx?.blob || (globalThis as any).netlify?.blobs;
  const r = await blob.get(SUBS_KEY);
  const arr: any[] = r ? JSON.parse(await r.text()) : [];

  // Evitar duplicados por endpoint
  const endpoint = sub?.endpoint;
  const next = endpoint
    ? [sub, ...arr.filter((x: any) => x.endpoint !== endpoint)]
    : arr;

  await blob.set(SUBS_KEY, JSON.stringify(next), {
    contentType: "application/json",
  });
  return { statusCode: 200, body: "OK" };
};
