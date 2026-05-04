import { ftsTermHits } from "#/indexing/fts.ts";
import type { ChunkRecord, ChunkSearchRow } from "./types.ts";

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
 * Score a single chunk against a search query.
 * Combines FTS term hits with vector similarity.
 * Returns null if the chunk doesn't match the query (no FTS hits and no phrase match).
 */
export function scoreChunk(params: {
  chunk: ChunkRecord;
  queryTerms: string[];
  queryText: string;
  queryVector: Float32Array | number[];
  ftsTermHits: (terms: string[], ...fields: string[]) => number;
}): ChunkSearchRow | null {
  const { chunk, queryTerms, queryText, queryVector, ftsTermHits } = params;

  const fts = ftsTermHits(
    queryTerms,
    chunk.subject,
    chunk.predicate,
    chunk.text,
  );

  const hay = `${chunk.subject} ${chunk.predicate} ${chunk.text}`.toLowerCase();
  const phraseMatch = queryText.length > 0 && hay.includes(queryText);

  if (fts === 0 && !phraseMatch) return null;

  const vecRank = cosineSimilarity(queryVector, chunk.vector);
  const score = fts * 1000 + (vecRank > 1e-12 ? vecRank : 0);

  return {
    subject: chunk.subject,
    predicate: chunk.predicate,
    object: chunk.text,
    vecRank: vecRank > 1e-12 ? vecRank : null,
    ftsRank: fts > 0 ? fts : null,
    score,
    world: chunk.world,
  };
}

/**
 * Build a map of subject → set of rdf:type values from chunks.
 */
export function buildSubjectTypes(
  chunks: ChunkRecord[],
): Map<string, Set<string>> {
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const subjectTypes = new Map<string, Set<string>>();
  for (const c of chunks) {
    if (c.predicate !== RDF_TYPE) continue;
    if (!subjectTypes.has(c.subject)) subjectTypes.set(c.subject, new Set());
    subjectTypes.get(c.subject)!.add(c.text);
  }
  return subjectTypes;
}

/**
 * Filter chunks by subjects, predicates, and types.
 */
export function filterChunks(params: {
  chunks: ChunkRecord[];
  subjects?: string[];
  predicates?: string[];
  types?: string[];
  subjectTypes: Map<string, Set<string>>;
}): ChunkRecord[] {
  const { chunks, subjects, predicates, types, subjectTypes } = params;

  return chunks.filter((c) => {
    if (subjects && subjects.length > 0 && !subjects.includes(c.subject)) {
      return false;
    }
    if (predicates && predicates.length > 0 && !predicates.includes(c.predicate)) {
      return false;
    }
    if (types && types.length > 0) {
      const st = subjectTypes.get(c.subject);
      if (!types.some((t) => st?.has(t))) return false;
    }
    return true;
  });
}
