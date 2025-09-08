// netlify/functions/list-subs.ts
import type { Handler } from "@netlify/functions";
import { getBlobStore, getList } from "./_store";

export const handler: Handler = async () => {
  try {
    const list = (await getList<any[]>("subs", "list")) || [];
    const store = getBlobStore("subs");
    const { blobs } = await store.list();
    const blobSubs: any[] = [];
    for (const b of blobs) {
      const s = await store.get(b.key, { type: "json" });
      if (s?.endpoint) blobSubs.push(s);
    }
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        listCount: list.length,
        blobCount: blobSubs.length,
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
