import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type {
  ChunkIndexState,
  ChunkRecord,
  ChunkSearchQuery,
  ChunkSearchRow,
} from "./types.ts";

export type { ChunkIndexState, ChunkRecord, ChunkSearchQuery, ChunkSearchRow };

export type ChunkIndexSearchQuery = Omit<ChunkSearchQuery, "worlds">;

/**
 * Data plane — operates on a single world's chunk index.
 */
export interface ChunkIndex {
  setChunk(chunk: ChunkRecord): Promise<void>;
  deleteChunk(factId: string): Promise<void>;
  getAll(): Promise<ChunkRecord[]>;
  search(input: ChunkIndexSearchQuery): Promise<ChunkSearchRow[]>;
}

/**
 * Management plane — lifecycle of per-world chunk indexes.
 */
export interface ChunkIndexManager {
  getChunkIndex(reference: WorldReference): Promise<ChunkIndex>;
  getIndexState(world: WorldReference): Promise<ChunkIndexState | null>;
  setIndexState(state: ChunkIndexState): Promise<void>;
  deleteChunkIndex(reference: WorldReference): Promise<void>;
}
