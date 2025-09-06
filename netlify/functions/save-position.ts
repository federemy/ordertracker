// netlify/functions/save-position.ts
import type { Handler } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }
  try {
    const { qty, avgPrice } = JSON.parse(event.body || "{}");
    if (!Number.isFinite(qty) || !Number.isFinite(avgPrice)) {
      return { statusCode: 400, body: "qty y avgPrice numéricos requeridos" };
    }
    const store = getStore("portfolio");
    await store.setJSON("eth", { qty, avgPrice });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};
