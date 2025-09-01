// netlify/functions/_store.ts
import { promises as fs } from "fs";
import path from "path";

type Json = any;

async function useBlobs<T>(
  fn: (mod: typeof import("@netlify/blobs")) => Promise<T>
): Promise<T> {
  // Intenta usar @netlify/blobs: si falla (dev local), hacemos fallback a archivos
  // IMPORTANT: no caches the import fail because Netlify dev reloads often.
  const mod = await import("@netlify/blobs").catch(() => null as any);
  if (!mod) throw new Error("NO_BLOBS");
  return fn(mod);
}

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
  try {
    // 1) Camino principal: Netlify Blobs
    return await useBlobs(async ({ getStore }) => {
      const store = getStore({ name });
      return (await store.get(key, { type: "json" })) as T | null;
    });
  } catch {
    // 2) Fallback para desarrollo local
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
  try {
    // 1) Camino principal: Netlify Blobs
    await useBlobs(async ({ getStore }) => {
      const store = getStore({ name });
      await store.set(key, JSON.stringify(value));
    });
  } catch {
    // 2) Fallback para desarrollo local
    const { base, file } = devFile(name, key);
    await ensureDir(base);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }
}
