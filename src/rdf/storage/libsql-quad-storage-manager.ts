import { type Client } from "@libsql/client";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { QuadStorage, QuadStorageManager } from "./quad-storage.ts";
import { formatWorldName } from "#/core/resolve.ts";
import { LibsqlQuadStorage } from "./libsql-quad-storage.ts";

export class LibsqlQuadStorageManager implements QuadStorageManager {
  private readonly storages = new Map<string, LibsqlQuadStorage>();

  constructor(
    private readonly client: Client,
  ) {}

  async getQuadStorage(reference: WorldReference): Promise<QuadStorage> {
    const key = formatWorldName(reference);
    let storage = this.storages.get(key);
    if (!storage) {
      storage = new LibsqlQuadStorage(this.client, reference);
      this.storages.set(key, storage);
    }
    return storage;
  }

  async deleteQuadStorage(reference: WorldReference): Promise<void> {
    const key = formatWorldName(reference);
    const storage = this.storages.get(key);
    if (storage) {
      await storage.clear();
      this.storages.delete(key);
    } else {
      // Ensure it's cleared from DB even if not cached
      const ns = reference.namespace ?? "_";
      await this.client.execute({
        sql: `DELETE FROM quads WHERE world_namespace = ? AND world_id = ?`,
        args: [ns, reference.id],
      });
    }
  }
}
