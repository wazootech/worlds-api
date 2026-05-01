import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
export type { WorldReference };
import type { StoredWorld } from "./types.ts";
export type { StoredWorld };

export interface WorldStorage {
  getWorld(reference: WorldReference): Promise<StoredWorld | null>;
  /** Atomically create a world. Throws if the world already exists. */
  createWorld(world: StoredWorld): Promise<void>;
  updateWorld(world: StoredWorld): Promise<void>;
  deleteWorld(reference: WorldReference): Promise<void>;
  listWorlds(namespace?: string): Promise<StoredWorld[]>;
}
