import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type { FactStorageManager } from "./interface.ts";
import { InMemoryFactStorage } from "#/rdf/storage/in-memory.ts";

export class InMemoryFactStorageManager implements FactStorageManager {
  private readonly storage = new Map<string, InMemoryFactStorage>();

  constructor(
    private readonly config?: {
      maxWorlds?: number;
    },
  ) {}

  async getFactStorage(
    reference: WorldReference,
  ): Promise<InMemoryFactStorage> {
    const key = formatWorldName(reference);
    let s = this.storage.get(key);
    if (!s) {
      s = new InMemoryFactStorage();
      this.storage.set(key, s);
    }
    return s;
  }

  async deleteFactStorage(reference: WorldReference): Promise<void> {
    this.storage.delete(formatWorldName(reference));
  }
}
