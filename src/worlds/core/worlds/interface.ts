import type { WorldReference } from "#/openapi/generated/types.gen.ts";
export type { WorldReference };
import type { StoredWorld } from "./types.ts";
export type { StoredWorld };

export interface WorldStorage {
  getWorld(reference: WorldReference): Promise<StoredWorld | null>;
  updateWorld(world: StoredWorld): Promise<void>;
  deleteWorld(reference: WorldReference): Promise<void>;
  listWorld(namespace?: string): Promise<StoredWorld[]>;
}