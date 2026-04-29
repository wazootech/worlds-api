import type {
  SearchRequest,
  SearchResult,
  World,
  WorldReference,
} from "#/api/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/search/embeddings/interface.ts";
import type { ChunkStorage } from "#/search/storage/interface.ts";
import type { WorldStorage } from "#/core/storage/interface.ts";
import { tokenizeSearchQuery } from "#/search/fts.ts";

export interface ChunkSearchDeps {
  chunkStorage: ChunkStorage;
  embeddings: EmbeddingsService;
  worldStorage: WorldStorage;
  formatWorldName: (ref: WorldReference) => string;
}

/**
 * Semantic + FTS search over chunk index (prior worlds ChunksSearchEngine behavior, adapted).
 */
export async function searchChunks(
  input: SearchRequest,
  targetRefs: WorldReference[],
  deps: ChunkSearchDeps,
): Promise<SearchResult[]> {
  const queryTerms = tokenizeSearchQuery(input.query);

  if (queryTerms.length === 0) {
    return [];
  }

  const queryVector = await deps.embeddings.embed(input.query);
  const rows = await deps.chunkStorage.search({
    worlds: targetRefs,
    queryText: input.query,
    queryTerms,
    queryVector,
    subjects: input.subjects,
    predicates: input.predicates,
    types: input.types,
  });

  const worldByKey = new Map<string, World>();
  for (const ref of targetRefs) {
    const stored = await deps.worldStorage.getWorld(ref);
    worldByKey.set(`${ref.namespace}/${ref.id}`, {
      name: deps.formatWorldName(ref),
      namespace: ref.namespace,
      id: ref.id,
      displayName: stored?.displayName ?? "",
      description: stored?.description,
      createTime: stored?.createTime ?? 0,
    });
  }

  return rows.map((row) => {
    const c = row.chunk;
    const world = worldByKey.get(`${c.world.namespace}/${c.world.id}`);
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
