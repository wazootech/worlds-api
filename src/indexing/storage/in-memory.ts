import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import { RDF_TYPE } from "#/rdf/vocab.ts";
import { ftsTermHits } from "#/indexing/fts.ts";
import type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
} from "./interface.ts";
import type { ChunkIndexState, ChunkRecord, ChunkSearchRow } from "./types.ts";

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
  private readonly chunkIdsByQuadId = new Map<string, Set<string>>();

  constructor(private readonly world: WorldReference) {}

  async setChunk(chunk: ChunkRecord): Promise<void> {
    if (
      formatWorldName(chunk.world) !== formatWorldName(this.world)
    ) {
      throw new Error("Chunk world does not match index world.");
    }

    const previous = this.chunksById.get(chunk.id);
    if (previous) {
      this.chunkIds.delete(previous.id);
      this.chunkIdsByQuadId.get(previous.quadId)?.delete(previous.id);
    }

    this.chunksById.set(chunk.id, chunk);
    this.chunkIds.add(chunk.id);

    let ids = this.chunkIdsByQuadId.get(chunk.quadId);
    if (!ids) {
      ids = new Set();
      this.chunkIdsByQuadId.set(chunk.quadId, ids);
    }
    ids.add(chunk.id);
  }

  async deleteChunk(quadId: string): Promise<void> {
    const ids = this.chunkIdsByQuadId.get(quadId);
    if (!ids) return;
    for (const id of ids) {
      this.chunksById.delete(id);
      this.chunkIds.delete(id);
    }
    this.chunkIdsByQuadId.delete(quadId);
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
        subject: chunk.subject,
        predicate: chunk.predicate,
        object: chunk.text,
        vecRank,
        ftsRank: fts > 0 ? fts : null,
        score,
        world: chunk.world,
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
    const key = formatWorldName(reference);
    let index = this.indexesByWorld.get(key);
    if (!index) {
      index = new InMemoryChunkIndex(reference);
      this.indexesByWorld.set(key, index);
    }
    return index;
  }

  async getIndexState(world: WorldReference): Promise<ChunkIndexState | null> {
    return this.indexStateByWorld.get(formatWorldName(world)) ?? null;
  }

  async setIndexState(state: ChunkIndexState): Promise<void> {
    this.indexStateByWorld.set(formatWorldName(state.world), state);
    // Ensure an index exists so data-plane writers can rely on it.
    await this.getChunkIndex(state.world);
  }

  async deleteChunkIndex(reference: WorldReference): Promise<void> {
    const key = formatWorldName(reference);
    this.indexesByWorld.delete(key);
    this.indexStateByWorld.delete(key);
  }
}
