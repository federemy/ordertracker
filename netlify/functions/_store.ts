// netlify/functions/_store.ts
// Usa SIEMPRE Netlify Blobs en producción. Solo hace fallback a archivos en dev local.
import { getStore } from "@netlify/blobs";
import { promises as fs } from "fs";
import path from "path";

type Json = any;

// Detectar si estamos en funciones desplegadas (prod/preview)
const IS_NETLIFY_FN =
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.DEPLOY_URL ||
  !!process.env.CONTEXT ||
  !!process.env.NETLIFY;

// Carpeta fallback para dev local (netlify dev / vite dev)
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
  if (IS_NETLIFY_FN) {
    // PRODUCCIÓN/PREVIEW: obligatorio usar Blobs (nada de disco)
    const store = getStore({ name });
    return (await store.get(key, { type: "json" })) as T | null;
  } else {
    // DEV LOCAL: fallback en archivos
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
  if (IS_NETLIFY_FN) {
    const store = getStore({ name });
    // No pases contentType: no hace falta y evita errores de tipos en algunas versiones
    await store.set(key, JSON.stringify(value));
  } else {
    const { base, file } = devFile(name, key);
    await ensureDir(base);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }
}
