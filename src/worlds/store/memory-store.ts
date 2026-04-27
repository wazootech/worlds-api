import type { StoredQuad } from "./stored-quad.ts";
import type { QuadStoreInterface } from "./store.ts";

function quadKey(q: StoredQuad): string {
  return `${q.subject}|${q.predicate}|${q.object}|${q.graph ?? ""}`;
}

/**
 * StoredQuadStore is an in-memory implementation of QuadStoreInterface.
 * Uses a Map for fast lookups; suitable for development/testing.
 */
export class StoredQuadStore implements QuadStoreInterface {
  private readonly quads = new Map<string, StoredQuad>();

  async add(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      const key = quadKey(q);
      this.quads.set(key, q);
    }
  }

  async remove(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      const key = quadKey(q);
      this.quads.delete(key);
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

  get size(): number {
    return this.quads.size;
  }

  toArray(): StoredQuad[] {
    return Array.from(this.quads.values());
  }
}
