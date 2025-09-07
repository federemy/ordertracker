// netlify/functions/_store.ts
import { getStore as _getStore } from "@netlify/blobs";

// Usa env si el runtime no tiene Blobs “auto-config”
export function getBlobStore(name: string) {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  // modo manual
  if (siteID && token) return _getStore({ name, siteID, token });
  // modo Netlify (auto)
  return _getStore(name);
}

export async function getList<T = unknown>(
  ns: string,
  key: string
): Promise<T | null> {
  const store = getBlobStore(ns);
  return (await store.get(key, { type: "json" })) as T | null;
}

export async function setList<T = unknown>(
  ns: string,
  key: string,
  value: T
): Promise<void> {
  const store = getBlobStore(ns);
  await store.setJSON(key, value as any);
}
