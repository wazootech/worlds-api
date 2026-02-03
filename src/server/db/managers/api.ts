import type { createClient as createTursoClient } from "@tursodatabase/api";
import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import type { LibsqlManager } from "#/server/db/manager.ts";

/**
 * TursoClient is the client for the Turso Database API.
 */
export type TursoClient = ReturnType<typeof createTursoClient>;

/**
 * TursoLibsqlManager implements LibsqlManager using the Turso Database API.
 */
export class TursoLibsqlManager implements LibsqlManager {
  public constructor(private readonly client: TursoClient) {}

  public async create(id: string): Promise<Client> {
    const database = await this.client.databases.create(id);
    const token = await this.client.databases.createToken(id);
    return createClient({
      url: `libsql://${database.hostname}`,
      authToken: token.jwt,
    });
  }

  public async get(id: string): Promise<Client> {
    const database = await this.client.databases.get(id);
    const token = await this.client.databases.createToken(id);
    return createClient({
      url: `libsql://${database.hostname}`,
      authToken: token.jwt,
    });
  }

  public async delete(id: string): Promise<void> {
    await this.client.databases.delete(id);
  }
}
