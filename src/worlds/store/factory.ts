import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { QuadStoreInterface } from "./store.ts";
import { StoredQuadStore } from "./memory-store.ts";

function keyOf(ref: WorldReference): string {
  return `${ref.namespace}/${ref.id}`;
}

const stores = new Map<string, QuadStoreInterface>();

export function getStore(ref: WorldReference): QuadStoreInterface {
  const key = keyOf(ref);
  let store = stores.get(key);
  if (!store) {
    store = new StoredQuadStore();
    stores.set(key, store);
  }
  return store;
}

export function deleteStore(ref: WorldReference): boolean {
  const key = keyOf(ref);
  return stores.delete(key);
}

export function hasStore(ref: WorldReference): boolean {
  const key = keyOf(ref);
  return stores.has(key);
}