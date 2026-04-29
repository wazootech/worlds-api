import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { RDF_TYPE } from "#/facts/rdf/vocab.ts";
import { ftsTermHits } from "#/search/fts.ts";
import type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
} from "./interface.ts";
import type { ChunkIndexState, ChunkRecord, ChunkSearchRow } from "./types.ts";

function worldKey(ref: WorldReference): string {
  return `${ref.namespace}/${ref.id}`;
}

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

export class InMemoryChunkIndex implements ChunkIndex {
  private readonly chunksById = new Map<string, ChunkRecord>();
  private readonly chunkIds = new Set<string>();
  private readonly chunkIdsByFactId = new Map<string, Set<string>>();

  constructor(private readonly world: WorldReference) {}

  async setChunk(chunk: ChunkRecord): Promise<void> {
    if (worldKey(chunk.world) !== worldKey(this.world)) {
      throw new Error("Chunk world does not match index world.");
    }

    const previous = this.chunksById.get(chunk.id);
    if (previous) {
      this.chunkIds.delete(previous.id);
      this.chunkIdsByFactId.get(previous.factId)?.delete(previous.id);
    }

    this.chunksById.set(chunk.id, chunk);
    this.chunkIds.add(chunk.id);

    let ids = this.chunkIdsByFactId.get(chunk.factId);
    if (!ids) {
      ids = new Set();
      this.chunkIdsByFactId.set(chunk.factId, ids);
    }
    ids.add(chunk.id);
  }

  async deleteChunk(factId: string): Promise<void> {
    const ids = this.chunkIdsByFactId.get(factId);
    if (!ids) return;
    for (const id of ids) {
      this.chunksById.delete(id);
      this.chunkIds.delete(id);
    }
    this.chunkIdsByFactId.delete(factId);
  }

  async getAll(): Promise<ChunkRecord[]> {
    return Array.from(this.chunkIds)
      .map((id) => this.chunksById.get(id))
      .filter((chunk): chunk is ChunkRecord => chunk !== undefined);
  }

  async search(input: ChunkIndexSearchQuery): Promise<ChunkSearchRow[]> {
    const chunks = await this.getAll();
    const subjectTypes = buildSubjectTypes(chunks);
    const qFull = input.queryText.toLowerCase();

    const rows: ChunkSearchRow[] = [];

    const filtered = chunks.filter((c) =>
      !input.subjects || input.subjects.length === 0 ||
      input.subjects.includes(c.subject)
    ).filter((c) =>
      !input.predicates || input.predicates.length === 0 ||
      input.predicates.includes(c.predicate)
    ).filter((c) => {
      if (!input.types || input.types.length === 0) return true;
      const st = subjectTypes.get(c.subject);
      return input.types.some((t) => st?.has(t));
    });

    for (const chunk of filtered) {
      const fts = ftsTermHits(
        input.queryTerms,
        chunk.subject,
        chunk.predicate,
        chunk.text,
      );
      const hay = `${chunk.subject} ${chunk.predicate} ${chunk.text}`
        .toLowerCase();
      const phraseMatch = qFull.length > 0 && hay.includes(qFull);

      if (fts === 0 && !phraseMatch) continue;

      const dot = dotNormalized(input.queryVector, chunk.vector);
      const vecRank = dot > 1e-12 ? dot : null;
      const score = fts * 1000 + (vecRank ?? 0);

      rows.push({
        chunk,
        vecRank,
        ftsRank: fts > 0 ? fts : null,
        score,
      });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows;
  }
}

export class InMemoryChunkIndexManager implements ChunkIndexManager {
  private readonly indexesByWorld = new Map<string, InMemoryChunkIndex>();
  private readonly indexStateByWorld = new Map<string, ChunkIndexState>();

  async getChunkIndex(reference: WorldReference): Promise<ChunkIndex> {
    const key = worldKey(reference);
    let index = this.indexesByWorld.get(key);
    if (!index) {
      index = new InMemoryChunkIndex(reference);
      this.indexesByWorld.set(key, index);
    }
    return index;
  }

  async getIndexState(world: WorldReference): Promise<ChunkIndexState | null> {
    return this.indexStateByWorld.get(worldKey(world)) ?? null;
  }

  async setIndexState(state: ChunkIndexState): Promise<void> {
    this.indexStateByWorld.set(worldKey(state.world), state);
    // Ensure an index exists so data-plane writers can rely on it.
    await this.getChunkIndex(state.world);
  }

  async deleteChunkIndex(reference: WorldReference): Promise<void> {
    const key = worldKey(reference);
    this.indexesByWorld.delete(key);
    this.indexStateByWorld.delete(key);
  }
}
