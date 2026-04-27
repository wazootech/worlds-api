import type { WorldReference } from "#/openapi/generated/types.gen.ts";

export interface StoredWorld {
  reference: WorldReference;
  displayName?: string;
  description?: string;
  createTime: number;
}
