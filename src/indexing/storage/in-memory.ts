import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import { ftsTermHits } from "#/indexing/fts.ts";
import { buildSubjectTypes, filterItems, scoreItem } from "../ranking.ts";
import type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
} from "./interface.ts";
import type { ChunkIndexState, ChunkRecord, ChunkSearchRow } from "./types.ts";

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
    const filtered = filterItems({
      items: chunks,
      subjects: input.subjects,
      predicates: input.predicates,
      types: input.types,
      subjectTypes,
    });

    const rows: ChunkSearchRow[] = [];
    for (const chunk of filtered) {
      const result = scoreItem({
        item: chunk,
        queryTerms: input.queryTerms,
        queryText: input.queryText,
        queryVector: input.queryVector,
        ftsTermHits,
      });
      if (result) rows.push(result);
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
