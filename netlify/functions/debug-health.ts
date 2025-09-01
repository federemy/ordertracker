import type { Handler } from "@netlify/functions";
import { getList, setList } from "./_store";

const handler: Handler = async () => {
  try {
    const stamp = Date.now();
    await setList("health", "ping", { stamp });
    const back = await getList<any>("health", "ping");

    const hasPub = !!process.env.VAPID_PUBLIC_KEY;
    const hasPriv = !!process.env.VAPID_PRIVATE_KEY;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        blobsWriteReadOk: back?.stamp === stamp,
        hasVapidPublic: hasPub,
        hasVapidPrivate: hasPriv,
      }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `debug-health error: ${e?.message || e}` };
  }
};

export { handler };
