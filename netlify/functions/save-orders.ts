import type { Handler } from "@netlify/functions";
import { getList, setList } from "./_store";

const STORE = "orders";
const KEY = "list";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (!event.body) return { statusCode: 400, body: "Missing body" };
    const body = JSON.parse(event.body);

    if (Array.isArray(body)) {
      await setList(STORE, KEY, body);
    } else if (body && body.asset && body.price && body.qty) {
      const existing = (await getList<any[]>(STORE, KEY)) || [];
      existing.push(body);
      await setList(STORE, KEY, existing);
    } else {
      return { statusCode: 400, body: "Invalid body" };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    console.error("save-orders error", e);
    return { statusCode: 500, body: e?.message || "save-orders error" };
  }
};

export { handler };
