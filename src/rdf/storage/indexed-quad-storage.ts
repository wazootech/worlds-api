import type { QuadStorage, StoredQuad } from "./quad-storage.ts";
import type { PatchHandler } from "#/indexing/search/types.ts";

export class IndexedQuadStorage implements QuadStorage {
  constructor(
    private readonly inner: QuadStorage,
    private readonly handlers: PatchHandler[],
  ) {}

  async setQuad(quad: StoredQuad): Promise<void> {
    await this.inner.setQuad(quad);
    const patch = { insertions: [quad], deletions: [] as StoredQuad[] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async deleteQuad(quad: StoredQuad): Promise<void> {
    await this.inner.deleteQuad(quad);
    const patch = { insertions: [] as StoredQuad[], deletions: [quad] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async setQuads(quads: StoredQuad[]): Promise<void> {
    if (quads.length === 0) return;
    await this.inner.setQuads(quads);
    const patch = { insertions: quads, deletions: [] as StoredQuad[] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async deleteQuads(quads: StoredQuad[]): Promise<void> {
    if (quads.length === 0) return;
    await this.inner.deleteQuads(quads);
    const patch = { insertions: [] as StoredQuad[], deletions: quads };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async findQuads(matchers: StoredQuad[]): Promise<StoredQuad[]> {
    return this.inner.findQuads(matchers);
  }

  async clear(): Promise<void> {
    const existing = await this.inner.findQuads([]);
    await this.inner.clear();
    if (existing.length === 0) return;
    const patch = { insertions: [] as StoredQuad[], deletions: existing };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }
}
