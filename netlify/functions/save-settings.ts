import type { Handler } from "@netlify/functions";
import { getList, setList } from "./_store";

type Body = { endpoint: string; freqMinutes: number };

const STORE = "settings";
const KEY = "byEndpoint";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const body = JSON.parse(event.body || "{}") as Body;
    const { endpoint, freqMinutes } = body;
    if (!endpoint || !Number.isFinite(freqMinutes) || freqMinutes <= 0) {
      return { statusCode: 400, body: "Invalid payload" };
    }

    const current = (await getList<Record<string, any>>(STORE, KEY)) || {};
    current[endpoint] = {
      ...(current[endpoint] || {}),
      freqMinutes: Math.max(1, Math.floor(freqMinutes)),
    };
    await setList(STORE, KEY, current);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "save-settings error" };
  }
};
