import type { Client } from "@libsql/client";
import { selectWorldData, upsertWorldData } from "./queries.sql.ts";
import { type WorldData, worldDataSchema } from "./schema.ts";

/**
 * WorldDataService handles persistence of the world-scoped N-Quads blob.
 */
export class WorldDataService {
  constructor(private readonly db: Client) {}

  /**
   * get fetches the current blob for the world.
   */
  async get(): Promise<WorldData | null> {
    const result = await this.db.execute(selectWorldData);
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return worldDataSchema.parse({
      blob: row.blob,
      updated_at: row.updated_at,
    });
  }

  /**
   * set updates the blob for the world.
   */
  async set(blob: Uint8Array, updatedAt: number): Promise<void> {
    await this.db.execute({
      sql: upsertWorldData,
      args: [blob, updatedAt],
    });
  }
}
