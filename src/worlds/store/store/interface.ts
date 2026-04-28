import type { QuadStorage } from "../quad/interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface StoreStorage {
  getQuadStorage(reference: WorldReference): Promise<QuadStorage>;
  deleteQuadStorage(reference: WorldReference): Promise<void>;
}
