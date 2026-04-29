import type { FactStorage } from "#/worlds/rdf/facts/interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface WorldFactStorage {
  getFactStorage(reference: WorldReference): Promise<FactStorage>;
  deleteFactStorage(reference: WorldReference): Promise<void>;
}