import type {
  World,
  WorldReference,
} from "#/rpc/openapi/generated/types.gen.ts";
import type { QuadStorageManager } from "#/rdf/storage/interface.ts";
import type { WorldStorage } from "./storage/interface.ts";
import { ftsTermHits } from "#/indexing/fts.ts";
import { formatWorldName } from "./resolve.ts";
import {
  buildSubjectTypes,
  filterItems,
  scoreItem,
  type SearchableItem,
} from "#/indexing/ranking.ts";
import type { SearchResult } from "#/rpc/openapi/generated/types.gen.ts";

/**
 * Naive FTS search over quads in the given worlds.
 * Scans all quads in each world's QuadStorage, scoring by term hits and phrase match.
 * Supports the same filters (subjects, predicates, types) as indexed search.
 * Results are sorted by score (descending), then alphabetically.
 *
 * This is a pure function (aside from storage calls) extracted from Worlds.search()
 * to make it independently testable.
 */
export async function searchNaiveFts(params: {
  targetRefs: WorldReference[];
  queryTerms: string[];
  queryText: string;
  subjects?: string[];
  predicates?: string[];
  types?: string[];
  quadStorageManager: QuadStorageManager;
  worldStorage: WorldStorage;
}): Promise<SearchResult[]> {
  const {
    targetRefs,
    queryTerms,
    queryText,
    subjects,
    predicates,
    types,
    quadStorageManager,
    worldStorage,
  } = params;

  const allResults: SearchResult[] = [];

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

    // Map StoredQuads to SearchableItems
    const items: SearchableItem[] = quads.map((q) => ({
      subject: q.subject,
      predicate: q.predicate,
      text: q.object,
      world: ref,
    }));

    const subjectTypes = buildSubjectTypes(items);
    const filtered = filterItems({
      items,
      subjects,
      predicates,
      types,
      subjectTypes,
    });

    for (const item of filtered) {
      const result = scoreItem({
        item,
        queryTerms,
        queryText,
        ftsTermHits,
      });
      if (result) {
        allResults.push({
          ...result,
          world,
        });
      }
    }
  }

  allResults.sort((a, b) =>
    (b.score - a.score) ||
    (a.world.name ?? "").localeCompare(b.world.name ?? "") ||
    (a.subject ?? "").localeCompare(b.subject ?? "") ||
    (a.predicate ?? "").localeCompare(b.predicate ?? "") ||
    (a.object ?? "").localeCompare(b.object ?? "")
  );

  return allResults;
}
