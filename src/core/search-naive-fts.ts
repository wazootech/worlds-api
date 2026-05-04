import type { World, WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import type { QuadStorageManager } from "#/rdf/storage/interface.ts";
import type { WorldStorage } from "./storage/interface.ts";
import { ftsTermHits } from "#/indexing/fts.ts";
import { formatWorldName } from "./resolve.ts";
import type { SearchRequest, SearchResult } from "#/rpc/openapi/generated/types.gen.ts";

/**
 * Naive FTS search over quads in the given worlds.
 * Scans all quads in each world's QuadStorage, scoring by term hits.
 * Returns results sorted by FTS rank (descending), then by world name, subject, predicate, object.
 *
 * This is a pure function (aside from storage calls) extracted from Worlds.searchNaiveFts()
 * to make it independently testable.
 */
export async function searchNaiveFts(params: {
  targetRefs: WorldReference[];
  queryTerms: string[];
  quadStorageManager: QuadStorageManager;
  worldStorage: WorldStorage;
}): Promise<SearchResult[]> {
  const { targetRefs, queryTerms, quadStorageManager, worldStorage } = params;

  const allResults: Array<{
    subject: string;
    predicate: string;
    object: string;
    ftsRank: number;
    world: World;
  }> = [];

  for (const ref of targetRefs) {
    const quadStorage = await quadStorageManager.getQuadStorage(ref);
    const quads = await quadStorage.findQuads([]);
    const meta = await worldStorage.getWorld(ref);
    const world: World = {
      name: formatWorldName(ref),
      namespace: ref.namespace,
      id: ref.id,
      displayName: meta?.displayName ?? "",
      description: meta?.description,
      createTime: meta?.createTime ?? 0,
    };

    for (const q of quads) {
      const score = ftsTermHits(queryTerms, q.subject, q.predicate, q.object);
      if (score > 0) {
        allResults.push({
          subject: q.subject,
          predicate: q.predicate,
          object: q.object,
          ftsRank: score,
          world,
        });
      }
    }
  }

  allResults.sort((a, b) =>
    (b.ftsRank! - a.ftsRank!) ||
    (a.world.name ?? "").localeCompare(b.world.name ?? "") ||
    (a.subject ?? "").localeCompare(b.subject ?? "") ||
    (a.predicate ?? "").localeCompare(b.predicate ?? "") ||
    (a.object ?? "").localeCompare(b.object ?? "")
  );

  return allResults.map((r) => ({
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    vecRank: null,
    ftsRank: r.ftsRank,
    score: r.ftsRank,
    world: r.world,
  }));
}
