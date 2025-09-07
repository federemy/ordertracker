// netlify/functions/save-position.ts
import type { Handler } from "@netlify/functions";
import { setList } from "./_store";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }
  try {
    const { qty, avgPrice } = JSON.parse(event.body || "{}");
    if (!Number.isFinite(qty) || !Number.isFinite(avgPrice)) {
      return { statusCode: 400, body: "qty y avgPrice numéricos requeridos" };
    }
    await setList("portfolio", "eth", { qty, avgPrice });
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

export default handler;
