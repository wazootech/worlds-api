import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type { QuadStorageManager } from "./quad-storage.ts";
import { InMemoryQuadStorage } from "./in-memory-quad-storage.ts";

export class InMemoryQuadStorageManager implements QuadStorageManager {
  private readonly storage = new Map<string, InMemoryQuadStorage>();

  constructor(
    private readonly config?: {
      maxWorlds?: number;
    },
  ) {}

  async getQuadStorage(
    reference: WorldReference,
  ): Promise<InMemoryQuadStorage> {
    const key = formatWorldName(reference);
    let s = this.storage.get(key);
    if (!s) {
      s = new InMemoryQuadStorage();
      this.storage.set(key, s);
    }
    return s;
  }

  async deleteQuadStorage(reference: WorldReference): Promise<void> {
    this.storage.delete(formatWorldName(reference));
  }
}
