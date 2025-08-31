// Almacenamiento simple en JSON para local y prod (sin Blobs)
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".netlify", "data");
async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  await ensureDir();
  const p = path.join(DATA_DIR, file);
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(file: string, data: any) {
  await ensureDir();
  const p = path.join(DATA_DIR, file);
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export async function getStore<T>(
  name: "subscriptions" | "orders",
  fallback: T
) {
  const file = `${name}.json`;
  return {
    async read(): Promise<T> {
      return readJSON<T>(file, fallback);
    },
    async write(data: T) {
      await writeJSON(file, data);
    },
    filePath: path.join(DATA_DIR, file),
  };
}
