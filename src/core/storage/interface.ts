import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
export type { WorldReference };
import type { StoredWorld } from "./types.ts";
export type { StoredWorld };

export interface WorldStorage {
  getWorld(reference: WorldReference): Promise<StoredWorld | null>;
  /** Atomically create a world. Throws if the world already exists. */
  createWorld(world: StoredWorld): Promise<void>;
  updateWorld(world: StoredWorld): Promise<void>;
  deleteWorld(reference: WorldReference): Promise<void>;
  listWorlds(namespace?: string, owner?: string): Promise<StoredWorld[]>;
  /** Get the owner of a namespace (by checking any world in that namespace). */
  getNamespaceOwner(namespace: string): Promise<string | null>;
}
