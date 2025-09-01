import { Handler } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export const handler: Handler = async () => {
  try {
    const store = getStore({ name: "subs" });
    const list = (await store.get("list", { type: "json" })) || [];
    return {
      statusCode: 200,
      body: JSON.stringify({
        count: Array.isArray(list) ? list.length : 0,
        list,
      }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
