import type { StoreStorage } from "./interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import { InMemoryQuadStorage } from "../quad/in-memory.ts";

function keyOfRef(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

export class InMemoryStoreStorage implements StoreStorage {
  private readonly stores = new Map<string, InMemoryQuadStorage>();

  async getQuadStorage(reference: WorldReference): Promise<InMemoryQuadStorage> {
    const key = keyOfRef(reference);
    let store = this.stores.get(key);
    if (!store) {
      store = new InMemoryQuadStorage();
      this.stores.set(key, store);
    }
    return store;
  }

  async deleteQuadStorage(reference: WorldReference): Promise<void> {
    this.stores.delete(keyOfRef(reference));
  }
}