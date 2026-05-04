import type { QuadStorage } from "./interface.ts";
import type { StoredQuad } from "./types.ts";

/**
 * FakeQuadStorage - a fake implementation of QuadStorage for testing.
 * Stores quads in memory and supports basic findQuads matching.
 */
export class FakeQuadStorage implements QuadStorage {
  private quads = new Map<string, StoredQuad>();

  async setQuad(quad: StoredQuad): Promise<void> {
    const key = JSON.stringify(quad);
    this.quads.set(key, quad);
  }

  async deleteQuad(_quad: StoredQuad): Promise<void> {
    const key = JSON.stringify(_quad);
    this.quads.delete(key);
  }

  async setQuads(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      await this.setQuad(q);
    }
  }

  async deleteQuads(quads: StoredQuad[]): Promise<void> {
    for (const q of quads) {
      await this.deleteQuad(q);
    }
  }

  async findQuads(matchers: StoredQuad[]): Promise<StoredQuad[]> {
    const allQuads = Array.from(this.quads.values());
    if (matchers.length === 0) return allQuads;
    return allQuads.filter((stored) =>
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
