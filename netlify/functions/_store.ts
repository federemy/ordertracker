// netlify/functions/_store.ts
// Store unificado: usa Netlify Blobs en prod y un JSON en disco en dev.
import { promises as fs } from "fs";
import path from "path";

type Json = any;

const isProd = !!process.env.NETLIFY || !!process.env.DEPLOY_URL;

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

function devFile(name: string, key: string) {
  const base = path.resolve(process.cwd(), ".netlify", "blob-dev", name);
  const file = path.join(base, `${key}.json`);
  return { base, file };
}

export async function getList<T = Json>(
  name: string,
  key: string
): Promise<T | null> {
  if (isProd) {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name });
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

export async function setList(
  name: string,
  key: string,
  value: Json
): Promise<void> {
  if (isProd) {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name });
    // sin contentType para evitar error de tipos en algunas versiones
    await store.set(key, JSON.stringify(value));
  } else {
    const { base, file } = devFile(name, key);
    await ensureDir(base);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }
}
