import type { WorldReference } from "#/openapi/generated/types.gen.ts";
export type { WorldReference };
import type { StoredWorld } from "./types.ts";
export type { StoredWorld };

export interface MetadataStorage {
  get(reference: WorldReference): Promise<StoredWorld | null>;
  put(world: StoredWorld): Promise<void>;
  delete(reference: WorldReference): Promise<void>;
  list(namespace?: string): Promise<StoredWorld[]>;
}