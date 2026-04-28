import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/worlds/embeddings/interface.ts";
import { SearchIndexHandler } from "#/worlds/index/patch/search-index-handler.ts";
import type { ChunkStorage } from "#/worlds/store/chunks/interface.ts";
import { InMemoryQuadStorage } from "#/worlds/store/quad/in-memory.ts";
import { IndexedQuadStorage } from "#/worlds/store/quad/indexed-quad-storage.ts";
import type { StoreStorage } from "./interface.ts";

function keyOfRef(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

/**
 * In-memory quad storage per world, with search index updates on write.
 */
export class IndexedStoreStorage implements StoreStorage {
  /** One indexed quad storage per world (stable SearchIndexHandler instance). */
  private readonly wrapped = new Map<string, IndexedQuadStorage>();

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkStorage,
  ) {}

  async getQuadStorage(reference: WorldReference): Promise<IndexedQuadStorage> {
    const key = keyOfRef(reference);
    let w = this.wrapped.get(key);
    if (!w) {
      const inner = new InMemoryQuadStorage();
      const handler = new SearchIndexHandler(
        this.embeddings,
        this.chunks,
        reference,
      );
      w = new IndexedQuadStorage(inner, [handler]);
      this.wrapped.set(key, w);
    }
    return w;
  }

  async deleteQuadStorage(reference: WorldReference): Promise<void> {
    this.wrapped.delete(keyOfRef(reference));
    await this.chunks.clearWorld(reference);
  }
}
