import type { QuadStorage, StoredQuad } from "./interface.ts";
import { storedQuadKey } from "./key.ts";

export class InMemoryQuadStorage implements QuadStorage {
  private readonly quads = new Map<string, StoredQuad>();

  async add(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      this.quads.set(storedQuadKey(q), q);
    }
  }

  async remove(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      this.quads.delete(storedQuadKey(q));
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
