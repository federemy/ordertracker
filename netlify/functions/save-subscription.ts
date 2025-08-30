import type { Handler } from "@netlify/functions";

const SUBS_KEY = "subs";
type Sub = any;

// Usamos un almacenamiento simple en memoria (resetea en cada deploy).
// Para persistir, reemplazalo por Netlify KV o Fauna.
let subs: Sub[] = [];

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const sub: Sub = JSON.parse(event.body || "{}");
    if (!sub || !sub.endpoint) {
      return { statusCode: 400, body: "Invalid subscription" };
    }

    // evita duplicados
    if (!subs.find((s) => s.endpoint === sub.endpoint)) {
      subs.push(sub);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, subsCount: subs.length }),
    };
  } catch (e) {
    console.error("save-subscription error", e);
    return { statusCode: 500, body: "Error saving subscription" };
  }
};

// Para que lo pueda importar send-push
export function getSubscriptions() {
  return subs;
}
