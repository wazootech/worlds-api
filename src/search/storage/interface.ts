import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type {
  ChunkIndexState,
  ChunkRecord,
  ChunkSearchQuery,
  ChunkSearchRow,
} from "./types.ts";

export type { ChunkIndexState, ChunkRecord, ChunkSearchQuery, ChunkSearchRow };

export interface ChunkStorage {
  setChunk(chunk: ChunkRecord): Promise<void>;
  deleteChunk(world: WorldReference, factId: string): Promise<void>;
  getByWorld(world: WorldReference): Promise<ChunkRecord[]>;
  search(input: ChunkSearchQuery): Promise<ChunkSearchRow[]>;
  getIndexState(world: WorldReference): Promise<ChunkIndexState | null>;
  markWorldIndexed(state: ChunkIndexState): Promise<void>;
  clearWorld(world: WorldReference): Promise<void>;
}
