import type { Handler } from "@netlify/functions";

const SUBS_KEY = "subs.json";

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  const sub = JSON.parse(event.body || "{}");
  if (!sub?.endpoint) {
    return { statusCode: 400, body: "Invalid subscription" };
  }

  // Netlify Blobs (disponible vía context.blob)
  const blobs: any =
    // @ts-ignore
    context?.blob || (globalThis as any).netlify?.blobs;

  const existing = await blobs.get(SUBS_KEY);
  const arr: any[] = existing ? JSON.parse(await existing.text()) : [];

  // Evitar duplicados por endpoint
  const next = [sub, ...arr.filter((x: any) => x.endpoint !== sub.endpoint)];

  await blobs.set(SUBS_KEY, JSON.stringify(next), {
    contentType: "application/json",
  });

  return { statusCode: 200, body: "OK" };
};
