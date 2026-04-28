import type { QuadStorage } from "./interface.ts";
import type { StoredQuad } from "./types.ts";
import type { PatchHandler } from "#/worlds/index/patch/types.ts";

/**
 * Delegates to inner storage and notifies patch handlers after mutations.
 */
export class IndexedQuadStorage implements QuadStorage {
  constructor(
    private readonly inner: QuadStorage,
    private readonly handlers: PatchHandler[],
  ) {}

  async add(quads: StoredQuad[]): Promise<void> {
    await this.inner.add(quads);
    if (quads.length === 0) return;
    const patch = { insertions: quads, deletions: [] as StoredQuad[] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async remove(quads: StoredQuad[]): Promise<void> {
    await this.inner.remove(quads);
    if (quads.length === 0) return;
    const patch = { insertions: [] as StoredQuad[], deletions: quads };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async query(matchers: StoredQuad[]): Promise<StoredQuad[]> {
    return this.inner.query(matchers);
  }

  async clear(): Promise<void> {
    const existing = await this.inner.query([]);
    await this.inner.clear();
    if (existing.length === 0) return;
    const patch = { insertions: [] as StoredQuad[], deletions: existing };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }
}
