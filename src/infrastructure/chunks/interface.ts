import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { ChunkIndexState, ChunkRecord } from "./types.ts";

export interface ChunkStorage {
  upsert(chunk: ChunkRecord): Promise<void>;
  deleteByFactId(world: WorldReference, factId: string): Promise<void>;
  getByWorld(world: WorldReference): Promise<ChunkRecord[]>;
  getIndexState(world: WorldReference): Promise<ChunkIndexState | null>;
  markWorldIndexed(state: ChunkIndexState): Promise<void>;
  clearWorld(world: WorldReference): Promise<void>;
}
