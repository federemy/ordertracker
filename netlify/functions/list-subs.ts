// netlify/functions/list-subs.ts
import type { Handler } from "@netlify/functions";
import { getBlobStore, getList } from "./_store";

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

const handler: Handler = async () => {
  try {
    // lista (subs/list)
    const list = (await getList<Sub[]>("subs", "list")) || [];

    // blobs individuales (subs/*) por si hay restos
    const store = getBlobStore("subs");
    const { blobs } = await store.list();
    const blobSubs: Sub[] = [];
    for (const b of blobs) {
      const s = await store.get(b.key, { type: "json" });
      if (s?.endpoint) blobSubs.push(s as Sub);
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        listCount: list.length,
        blobCount: blobSubs.length,
        // para no imprimir datos sensibles, mostramos sólo endpoints
        list: list.map((s) => ({ endpoint: s.endpoint })),
        blobs: blobSubs.map((s) => ({ endpoint: s.endpoint })),
      }),
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
