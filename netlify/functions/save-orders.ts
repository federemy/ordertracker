import type { Handler } from "@netlify/functions";

type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

const ORDERS_KEY = "orders.json"; // blob único por usuario
const PREV_SIGNS_KEY = "prev-signs.json"; // persistimos cruces

export const handler: Handler = async (event, ctx) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "POST only" };

  const orders: Order[] = JSON.parse(event.body || "[]");

  // Guardar órdenes
  // @ts-ignore – Netlify Blobs disponible en runtime
  const blob = ctx?.blob || (globalThis as any).netlify?.blobs;
  await blob.set(ORDERS_KEY, JSON.stringify(orders), {
    contentType: "application/json",
  });

  // Asegurar estructura de prev_signs
  let prevSigns: Record<string, number> = {};
  try {
    const old = await blob.get(PREV_SIGNS_KEY);
    prevSigns = old ? JSON.parse(await old.text()) : {};
  } catch {}
  for (const o of orders) if (!(o.id in prevSigns)) prevSigns[o.id] = 0;
  await blob.set(PREV_SIGNS_KEY, JSON.stringify(prevSigns), {
    contentType: "application/json",
  });

  return { statusCode: 200, body: "OK" };
};
