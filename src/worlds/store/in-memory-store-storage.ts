import type { StoreStorage, QuadStorage, StoredQuad } from "./store-storage.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

function keyOfRef(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

function quadKey(q: StoredQuad): string {
  return `${q.subject}|${q.predicate}|${q.object}|${q.graph ?? ""}`;
}

/**
 * InMemoryQuadStorage is a Map-backed QuadStorage for development/testing.
 */
class InMemoryQuadStorage implements QuadStorage {
  private readonly quads = new Map<string, StoredQuad>();

  async add(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      this.quads.set(quadKey(q), q);
    }
  }

  async remove(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      this.quads.delete(quadKey(q));
    }
  }

  async query(matchers: StoredQuad[]): Promise<StoredQuad[]> {
    return Array.from(this.quads.values()).filter((stored) =>
      matchers.every((m) =>
        (!m.subject || m.subject === stored.subject) &&
        (!m.predicate || m.predicate === stored.predicate) &&
        (!m.object || m.object === stored.object) &&
        (!m.graph || m.graph === stored.graph)
      )
    );
  }

  async clear(): Promise<void> {
    this.quads.clear();
  }
}

/**
 * InMemoryStoreStorage is a Map-backed StoreStorage for development/testing.
 */
export class InMemoryStoreStorage implements StoreStorage {
  private readonly stores = new Map<string, QuadStorage>();

  async getQuadStorage(reference: WorldReference): Promise<QuadStorage> {
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