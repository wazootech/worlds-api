import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface StoredWorld {
  reference: WorldReference;
  displayName?: string;
  description?: string;
  createTime: number;
}

/**
 * MetadataStorage handles world metadata (management plane).
 * Can be in-memory, SQLite, KV, etc.
 */
export interface MetadataStorage {
  get(reference: WorldReference): Promise<StoredWorld | null>;
  put(world: StoredWorld): Promise<void>;
  delete(reference: WorldReference): Promise<void>;
  list(namespace?: string): Promise<StoredWorld[]>;
}