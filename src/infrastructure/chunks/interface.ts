import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { ChunkRecord } from "./types.ts";

export interface ChunkStorage {
  upsert(chunk: ChunkRecord): Promise<void>;
  deleteByFactId(world: WorldReference, factId: string): Promise<void>;
  getByWorld(world: WorldReference): Promise<ChunkRecord[]>;
  clearWorld(world: WorldReference): Promise<void>;
}
