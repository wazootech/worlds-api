import type { QuadStorage, StoredQuad } from "../interface.ts";
import { storedQuadKey } from "../quad-key.ts";

export class InMemoryQuadStorage implements QuadStorage {
  private readonly quads = new Map<string, StoredQuad>();

  async setQuad(quad: StoredQuad): Promise<void> {
    this.quads.set(storedQuadKey(quad), quad);
  }

  async deleteQuad(quad: StoredQuad): Promise<void> {
    this.quads.delete(storedQuadKey(quad));
  }

  async setQuads(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      this.quads.set(storedQuadKey(q), q);
    }
  }

  async deleteQuads(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      this.quads.delete(storedQuadKey(q));
    }
  }

  async findQuads(matchers: StoredQuad[]): Promise<StoredQuad[]> {
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
