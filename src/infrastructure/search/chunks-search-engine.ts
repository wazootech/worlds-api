import type {
  SearchRequest,
  SearchResult,
  World,
  WorldReference,
} from "#/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/infrastructure/embeddings/interface.ts";
import type { ChunkStorage } from "#/infrastructure/chunks/interface.ts";
import type { ChunkRecord } from "#/infrastructure/chunks/types.ts";
import type { WorldStorage } from "#/worlds/store/worlds/interface.ts";
import { RDF_TYPE } from "#/worlds/rdf/vocab.ts";
import { ftsTermHits, tokenizeSearchQuery } from "#/worlds/search/fts.ts";

function dotNormalized(
  a: Float32Array | number[],
  b: Float32Array | number[],
): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function buildSubjectTypes(chunks: ChunkRecord[]): Map<string, Set<string>> {
  const subjectTypes = new Map<string, Set<string>>();
  for (const c of chunks) {
    if (c.predicate !== RDF_TYPE) continue;
    if (!subjectTypes.has(c.subject)) subjectTypes.set(c.subject, new Set());
    subjectTypes.get(c.subject)!.add(c.text);
  }
  return subjectTypes;
}

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
  const qFull = input.query.toLowerCase();

  const subjects = input.subjects;
  const predicates = input.predicates;
  const types = input.types;

  const allResults: SearchResult[] = [];

  for (const ref of targetRefs) {
    const chunks = await deps.chunkStorage.getByWorld(ref);
    const subjectTypes = buildSubjectTypes(chunks);

    const stored = await deps.worldStorage.getWorld(ref);
    const world: World = {
      name: deps.formatWorldName(ref),
      namespace: ref.namespace,
      id: ref.id,
      displayName: stored?.displayName ?? "",
      description: stored?.description,
      createTime: stored?.createTime ?? 0,
    };

    const filtered = chunks.filter((c) =>
      !subjects || subjects.length === 0 || subjects.includes(c.subject)
    ).filter((c) =>
      !predicates || predicates.length === 0 || predicates.includes(c.predicate)
    ).filter((c) => {
      if (!types || types.length === 0) return true;
      const st = subjectTypes.get(c.subject);
      return types.some((t) => st?.has(t));
    });

    for (const c of filtered) {
      const fts = ftsTermHits(queryTerms, c.subject, c.predicate, c.text);
      const hay = `${c.subject} ${c.predicate} ${c.text}`.toLowerCase();
      const phraseMatch = qFull.length > 0 && hay.includes(qFull);

      // Keyword parity with naive FTS: require term hits or full-query substring.
      // (Pure vector hits without lexical overlap are too noisy with placeholder embeddings.)
      if (fts === 0 && !phraseMatch) continue;

      const dot = dotNormalized(queryVector, c.vector);
      const vecRank: number | null = dot > 1e-12 ? dot : null;

      const score = fts * 1000 + (vecRank ?? 0);

      allResults.push({
        subject: c.subject,
        predicate: c.predicate,
        object: c.text,
        vecRank,
        ftsRank: fts > 0 ? fts : null,
        score,
        world,
      });
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults;
}
