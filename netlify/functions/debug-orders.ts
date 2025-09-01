import type { Handler } from "@netlify/functions";
import { getList } from "./_store";

const STORE = "orders";
const KEY = "list";

const handler: Handler = async () => {
  try {
    const list = (await getList<any[]>(STORE, KEY)) || [];
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: list.length, sample: list.slice(0, 3) }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `debug-orders error: ${e?.message || e}` };
  }
};

export { handler };
