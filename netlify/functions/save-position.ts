import type { Handler } from "@netlify/functions";
import { setList } from "./_store";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "POST only" };
  try {
    const { qty, avgPrice } = JSON.parse(event.body || "{}");
    const q = Number(qty),
      a = Number(avgPrice);
    if (!Number.isFinite(q) || !Number.isFinite(a) || q <= 0 || a <= 0)
      return { statusCode: 400, body: "qty y avgPrice numéricos > 0" };
    await setList("portfolio", "eth", { qty: q, avgPrice: a });
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};
