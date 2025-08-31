import type { Handler } from "@netlify/functions";
import { getStore } from "./_store";

type Order = {
  id: string;
  ts: number;
  asset: string;
  qty: number;
  price: number;
  side?: "BUY" | "SELL";
};

type OrdersDB = { list: Order[] };
const ORDERS_FALLBACK: OrdersDB = { list: [] };

export async function getOrders(): Promise<Order[]> {
  const store = await getStore<OrdersDB>("orders", ORDERS_FALLBACK);
  const db = await store.read();
  return db.list;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const payload = JSON.parse(event.body || "{}") as {
      orders?: Order[];
      order?: Order;
    };
    const store = await getStore<OrdersDB>("orders", ORDERS_FALLBACK);
    const db = await store.read();

    if (payload.orders && Array.isArray(payload.orders)) {
      // Reemplaza todo (sincronización)
      db.list = payload.orders;
      await store.write(db);
    } else if (payload.order) {
      // Inserta al principio si no existe
      const exists = db.list.find((o) => o.id === payload.order!.id);
      if (!exists) db.list.unshift(payload.order);
      await store.write(db);
    } else {
      return { statusCode: 400, body: "Invalid body" };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "save-orders error" };
  }
};
