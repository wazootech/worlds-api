import type {
  SearchRequest,
  SearchResult,
  World,
  WorldReference,
} from "#/rpc/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import type { WorldStorage } from "#/core/storage/interface.ts";
import { tokenizeSearchQuery } from "#/indexing/fts.ts";

/**
 * Dependency injection for {@link searchChunks}.
 * Flat deps: chunk index, embeddings, world storage, and name formatting.
 */
export interface ChunkSearchOptions {
  chunkIndexManager: ChunkIndexManager;
  embeddingsService: EmbeddingsService;
  worldStorage: WorldStorage;
  formatWorldName: (ref: WorldReference) => string;
}

/**
 * Vector + full-text search over per-world {@link ChunkIndexManager} indexes.
 * Worlds **without** chunk indexes fall back to naive FTS inside
 * {@link ../core/worlds.ts}; merged ordering happens there.
 */
export async function searchChunks(
  input: SearchRequest,
  targetRefs: WorldReference[],
  options: ChunkSearchOptions,
): Promise<SearchResult[]> {
  const queryTerms = tokenizeSearchQuery(input.query);

  if (queryTerms.length === 0) {
    return [];
  }

  const queryVector = await options.embeddingsService.embed(input.query);
  const rows = (
    await Promise.all(targetRefs.map(async (ref) => {
      const index = await options.chunkIndexManager.getChunkIndex(ref);
      return await index.search({
        queryText: input.query,
        queryTerms,
        queryVector,
        subjects: input.subjects,
        predicates: input.predicates,
        types: input.types,
      });
    }))
  ).flat();

  rows.sort((a, b) => b.score - a.score);

  const worldByKey = new Map<string, World>();
  for (const ref of targetRefs) {
    const stored = await options.worldStorage.getWorld(ref);
    worldByKey.set(options.formatWorldName(ref), {
      name: options.formatWorldName(ref),
      namespace: ref.namespace,
      id: ref.id,
      displayName: stored?.displayName ?? "",
      description: stored?.description,
      createTime: stored?.createTime ?? 0,
    });
  }

  return rows.map((row) => {
    const c = row.chunk;
    const world = worldByKey.get(options.formatWorldName(c.world));
    if (!world) {
      throw new Error(`Chunk result references untargeted world`);
    }
    return {
      subject: c.subject,
      predicate: c.predicate,
      object: c.text,
      vecRank: row.vecRank,
      ftsRank: row.ftsRank,
      score: row.score,
      world,
    };
  });
}
