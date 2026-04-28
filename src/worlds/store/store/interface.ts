import type { QuadStorage } from "#/worlds/rdf/quads/interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface StoreStorage {
  getQuadStorage(reference: WorldReference): Promise<QuadStorage>;
  deleteQuadStorage(reference: WorldReference): Promise<void>;
}