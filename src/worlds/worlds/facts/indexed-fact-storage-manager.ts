import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/worlds/embeddings/interface.ts";
import { SearchIndexHandler } from "#/worlds/index/patch/search-index-handler.ts";
import type { ChunkStorage } from "#/worlds/search/chunks/interface.ts";
import { InMemoryFactStorage } from "#/worlds/rdf/facts/in-memory.ts";
import { IndexedFactStorage } from "#/worlds/rdf/facts/indexed.ts";
import type { FactStorage } from "#/worlds/rdf/facts/interface.ts";
import type { FactStorageManager } from "./interface.ts";

function keyOfRef(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

export interface IndexedFactStorageManagerConfig {
  embeddings: EmbeddingsService;
  chunks: ChunkStorage;
}

export class IndexedFactStorageManager implements FactStorageManager {
  private readonly wrapped = new Map<string, IndexedFactStorage>();

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkStorage,
  ) {}

  async getFactStorage(reference: WorldReference): Promise<IndexedFactStorage> {
    const key = keyOfRef(reference);
    let w = this.wrapped.get(key);
    if (!w) {
      const inner = new InMemoryFactStorage();
      const handler = new SearchIndexHandler(
        this.embeddings,
        this.chunks,
        reference,
      );
      w = new IndexedFactStorage(inner, [handler]);
      this.wrapped.set(key, w);
    }
    return w;
  }

  async deleteFactStorage(reference: WorldReference): Promise<void> {
    this.wrapped.delete(keyOfRef(reference));
    await this.chunks.clearWorld(reference);
  }
}