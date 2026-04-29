import type { FactStorage } from "#/worlds/rdf/facts/interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface FactStorageManager {
  getFactStorage(reference: WorldReference): Promise<FactStorage>;
  deleteFactStorage(reference: WorldReference): Promise<void>;
}