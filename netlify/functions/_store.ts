// netlify/functions/_store.ts
import { promises as fs } from "fs";
import path from "path";

type Json = any;

const isProd =
  !!process.env.DEPLOY_URL || !!process.env.CONTEXT || !!process.env.NETLIFY;

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

function devFile(name: string, key: string) {
  const base = path.resolve(process.cwd(), ".netlify", "blob-dev", name);
  const file = path.join(base, `${key}.json`);
  return { base, file };
}

async function withBlobs<T>(
  fn: (getStore: typeof import("@netlify/blobs").getStore) => Promise<T>
): Promise<T> {
  const mod = await import("@netlify/blobs").catch(() => null as any);
  if (!mod || !mod.getStore) {
    if (isProd) {
      throw new Error(
        "@netlify/blobs no disponible en producción. Instalá la dependencia (npm i @netlify/blobs) y redeploy."
      );
    }
    // dev: forzamos fallback a archivos
    throw new Error("BLOBS_UNAVAILABLE_DEV");
  }
  return fn(mod.getStore);
}

export async function getList<T = Json>(
  name: string,
  key: string
): Promise<T | null> {
  try {
    return await withBlobs(async (getStore) => {
      const store = getStore({ name });
      return (await store.get(key, { type: "json" })) as T | null;
    });
  } catch (e: any) {
    if (isProd && e?.message && !e.message.includes("BLOBS_UNAVAILABLE_DEV")) {
      // en prod NO hacemos fallback; devolvemos error hacia arriba
      throw e;
    }
    // dev fallback
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
  try {
    await withBlobs(async (getStore) => {
      const store = getStore({ name });
      await store.set(key, JSON.stringify(value));
    });
  } catch (e: any) {
    if (isProd && e?.message && !e.message.includes("BLOBS_UNAVAILABLE_DEV")) {
      throw e;
    }
    // dev fallback
    const { base, file } = devFile(name, key);
    await ensureDir(base);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }
}
