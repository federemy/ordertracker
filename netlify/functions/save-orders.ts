import type { Handler } from "@netlify/functions";
import { getList, setList } from "./_store";

const STORE = "orders";
const KEY = "list";

type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

function isOrder(x: any): x is Order {
  return (
    x &&
    typeof x.id === "string" &&
    typeof x.ts === "number" &&
    typeof x.asset === "string" &&
    Number.isFinite(x.qty) &&
    Number.isFinite(x.price)
  );
}

const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    if (!event.body) {
      return { statusCode: 400, body: "Missing body" };
    }

    let body: any;
    try {
      body = JSON.parse(event.body);
    } catch (e: any) {
      return {
        statusCode: 400,
        body: `Invalid JSON: ${e?.message || "parse error"}`,
      };
    }

    // Permite array de órdenes o una sola orden
    if (Array.isArray(body)) {
      const bad = body.filter((x) => !isOrder(x));
      if (bad.length) {
        return {
          statusCode: 400,
          body: `Invalid order(s) in array. Expected {id,ts,asset,qty,price,side?}.`,
        };
      }
      await setList(STORE, KEY, body);
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, count: body.length }),
      };
    } else {
      if (!isOrder(body)) {
        return {
          statusCode: 400,
          body: "Invalid order object. Expected {id,ts,asset,qty,price,side?}.",
        };
      }
      const existing = (await getList<Order[]>(STORE, KEY)) || [];
      existing.unshift(body); // prepend
      await setList(STORE, KEY, existing);
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, count: existing.length }),
      };
    }
  } catch (e: any) {
    // devolvé detalle para saber QUÉ falla en prod
    return { statusCode: 500, body: `save-orders error: ${e?.message || e}` };
  }
};

export { handler };
