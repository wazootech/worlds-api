import { join } from "@std/path";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { LibsqlManager } from "#/server/db/libsql/manager.ts";

/**
 * FileLibsqlManager implements LibsqlManager using local files.
 */
export class FileLibsqlManager implements LibsqlManager {
  public constructor(private readonly baseDir: string) {}

  public async create(id: string): Promise<Client> {
    const path = join(this.baseDir, `${id}.db`);
    await Deno.mkdir(this.baseDir, { recursive: true });
    return createClient({
      url: `file:${path}`,
    });
  }

  public get(id: string): Promise<Client> {
    const path = join(this.baseDir, `${id}.db`);
    return Promise.resolve(createClient({
      url: `file:${path}`,
    }));
  }

  public async delete(id: string): Promise<void> {
    const path = join(this.baseDir, `${id}.db`);
    try {
      await Deno.remove(path);
      // Also try to remove -wal and -shm files if they exist
      await Deno.remove(`${path}-wal`).catch(() => {});
      await Deno.remove(`${path}-shm`).catch(() => {});
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}
