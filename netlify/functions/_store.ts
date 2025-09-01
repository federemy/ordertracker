// netlify/functions/_store.ts
import { getStore } from "@netlify/blobs";
import { promises as fs } from "fs";
import path from "path";

type Json = any;
const IS_FN =
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.DEPLOY_URL ||
  !!process.env.CONTEXT ||
  !!process.env.NETLIFY;

function makeStore(name: string) {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteID || !token) return getStore({ name }); // intentará auto
  return getStore({ name, siteID, token }); // modo manual
}

// fallback local solo para `netlify dev`
function devFile(name: string, key: string) {
  const base = path.resolve(process.cwd(), ".netlify", "blob-dev", name);
  const file = path.join(base, `${key}.json`);
  return { base, file };
}
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

export async function getList<T = Json>(
  name: string,
  key: string
): Promise<T | null> {
  if (IS_FN) {
    const store = makeStore(name);
    return (await store.get(key, { type: "json" })) as T | null;
  } else {
    const { base, file } = devFile(name, key);
    try {
      await ensureDir(base);
      const raw = await fs.readFile(file, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
export async function setList(name: string, key: string, value: Json) {
  if (IS_FN) {
    const store = makeStore(name);
    await store.set(key, JSON.stringify(value));
  } else {
    const { base, file } = devFile(name, key);
    await ensureDir(base);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }
}
