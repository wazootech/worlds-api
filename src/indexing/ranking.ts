import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import type { ChunkSearchRow } from "./storage/types.ts";

/**
 * Generic interface for items that can be searched (Chunks or Quads).
 */
export interface SearchableItem {
  subject: string;
  predicate: string;
  text: string;
  vector?: Float32Array | number[];
  world: WorldReference;
}

/**
 * Cosine similarity between two vectors (both should be normalized for meaningful results).
 * Returns 0 when magnitude is near-zero to avoid division issues.
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[],
): number {
  let dot = 0, magA = 0, magB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom < 1e-12 ? 0 : dot / denom;
}

/**
 * Score a single item against a search query.
 * Combines FTS term hits with vector similarity.
 * Returns null if the item doesn't match the query (no FTS hits and no phrase match).
 */
export function scoreItem(params: {
  item: SearchableItem;
  queryTerms: string[];
  queryText: string;
  queryVector?: Float32Array | number[];
  ftsTermHits: (terms: string[], ...fields: string[]) => number;
}): ChunkSearchRow | null {
  const { item, queryTerms, queryText, queryVector, ftsTermHits } = params;

  const fts = ftsTermHits(
    queryTerms,
    item.subject,
    item.predicate,
    item.text,
  );

  const hay = `${item.subject} ${item.predicate} ${item.text}`.toLowerCase();
  const phraseMatch = queryText.length > 0 &&
    hay.includes(queryText.toLowerCase());

  if (fts === 0 && !phraseMatch) return null;

  let vecRank: number | null = null;
  if (queryVector && item.vector) {
    const sim = cosineSimilarity(queryVector, item.vector);
    vecRank = sim > 1e-12 ? sim : null;
  }

  const score = fts * 1000 + (vecRank ?? 0);

  return {
    subject: item.subject,
    predicate: item.predicate,
    object: item.text,
    vecRank,
    ftsRank: fts > 0 ? fts : null,
    score,
    world: item.world,
  };
}

/**
 * Build a map of subject → set of rdf:type values from searchable items.
 */
export function buildSubjectTypes(
  items: SearchableItem[],
): Map<string, Set<string>> {
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const subjectTypes = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.predicate !== RDF_TYPE) continue;
    if (!subjectTypes.has(item.subject)) {
      subjectTypes.set(item.subject, new Set());
    }
    subjectTypes.get(item.subject)!.add(item.text);
  }
  return subjectTypes;
}

/**
 * Filter items by subjects, predicates, and types.
 */
export function filterItems<T extends SearchableItem>(params: {
  items: T[];
  subjects?: string[];
  predicates?: string[];
  types?: string[];
  subjectTypes: Map<string, Set<string>>;
}): T[] {
  const { items, subjects, predicates, types, subjectTypes } = params;

  return items.filter((item) => {
    if (subjects && subjects.length > 0 && !subjects.includes(item.subject)) {
      return false;
    }
    if (
      predicates && predicates.length > 0 &&
      !predicates.includes(item.predicate)
    ) {
      return false;
    }
    if (types && types.length > 0) {
      const st = subjectTypes.get(item.subject);
      if (!types.some((t) => st?.has(t))) return false;
    }
    return true;
  });
}
