import { type Client } from "@libsql/client";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { StoredWorld } from "./types.ts";
import type { WorldStorage } from "./interface.ts";
import { WorldAlreadyExistsError, WorldNotFoundError } from "#/errors.ts";

export class LibsqlWorldStorage implements WorldStorage {
  private initialized = false;

  constructor(private readonly client: Client) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS worlds (
        namespace TEXT NOT NULL DEFAULT '_',
        id TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        create_time INTEGER NOT NULL,
        PRIMARY KEY (namespace, id)
      )
    `);
    this.initialized = true;
  }

  async getWorld(reference: WorldReference): Promise<StoredWorld | null> {
    await this.ensureInitialized();
    const { namespace, id } = reference;
    const result = await this.client.execute({
      sql: `SELECT * FROM worlds WHERE namespace = ? AND id = ?`,
      args: [namespace ?? "_", id],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, unknown>;
    return {
      reference: {
        namespace: row["namespace"] as string,
        id: row["id"] as string,
      },
      displayName: row["display_name"] as string | undefined,
      description: row["description"] as string | undefined,
      createTime: row["create_time"] as number,
    };
  }

  async createWorld(world: StoredWorld): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = world.reference;
    const existing = await this.getWorld({ namespace, id });
    if (existing) {
      throw new WorldAlreadyExistsError({ namespace, id });
    }
    await this.client.execute({
      sql:
        `INSERT INTO worlds (namespace, id, display_name, description, create_time)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        namespace ?? "_",
        id,
        world.displayName ?? null,
        world.description ?? null,
        world.createTime,
      ],
    });
  }

  async updateWorld(world: StoredWorld): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = world.reference;
    const existing = await this.getWorld({ namespace, id });
    if (!existing) {
      throw new WorldNotFoundError({ namespace, id });
    }
    await this.client.execute({
      sql: `UPDATE worlds SET display_name = ?, description = ?
            WHERE namespace = ? AND id = ?`,
      args: [
        world.displayName ?? null,
        world.description ?? null,
        namespace ?? "_",
        id,
      ],
    });
  }

  async deleteWorld(reference: WorldReference): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = reference;
    const existing = await this.getWorld({ namespace, id });
    if (!existing) {
      throw new WorldNotFoundError({ namespace, id });
    }
    await this.client.execute({
      sql: `DELETE FROM worlds WHERE namespace = ? AND id = ?`,
      args: [namespace ?? "_", id],
    });
  }

  async listWorlds(namespace?: string): Promise<StoredWorld[]> {
    await this.ensureInitialized();
    const result = namespace
      ? await this.client.execute({
        sql: `SELECT * FROM worlds WHERE namespace = ? ORDER BY namespace, id`,
        args: [namespace],
      })
      : await this.client.execute({
        sql: `SELECT * FROM worlds ORDER BY namespace, id`,
      });
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        reference: {
          namespace: r["namespace"] as string,
          id: r["id"] as string,
        },
        displayName: r["display_name"] as string | undefined,
        description: r["description"] as string | undefined,
        createTime: r["create_time"] as number,
      };
    });
  }
}
