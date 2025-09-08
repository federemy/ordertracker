import type { Handler } from "@netlify/functions";
import { getList } from "./_store";

export const handler: Handler = async () => {
  try {
    const pos = await getList("portfolio", "eth");
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, position: pos }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};
