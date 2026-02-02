import { type Client, createClient } from "@libsql/client";
import { ulid } from "@std/ulid";
import { initializeDatabase, initializeWorldDatabase } from "./db/init.ts";
import { organizationsAdd } from "./db/resources/organizations/queries.sql.ts";
import type { Embeddings } from "./embeddings/embeddings.ts";
import type { LibsqlManager } from "./db/libsql/manager.ts";

export interface TestContext {
  libsqlClient: Client;
  embeddings: Embeddings;
  libsqlManager?: LibsqlManager;
  admin?: {
    apiKey: string;
  };
}

/**
 * MemoryLibsqlManager implements LibsqlManager using in-memory databases.
 */
class MemoryLibsqlManager implements LibsqlManager {
  private dbs = new Map<string, Client>();

  public async create(id: string): Promise<Client> {
    const client = createClient({ url: ":memory:" });
    await initializeWorldDatabase(client);
    this.dbs.set(id, client);
    return client;
  }

  public async get(id: string): Promise<Client> {
    let client = this.dbs.get(id);
    if (!client) {
      client = await this.create(id);
    }
    return client;
  }

  public delete(id: string): Promise<void> {
    this.dbs.delete(id);
    return Promise.resolve();
  }
}

export async function createTestContext(): Promise<TestContext> {
  const client = createClient({ url: ":memory:" });
  await initializeDatabase(client);

  const mockEmbeddings: Embeddings = {
    dimensions: 1536,
    embed: (texts: string | string[]) => {
      const count = Array.isArray(texts) ? texts.length : 1;
      return Promise.resolve(Array(count).fill(Array(1536).fill(0)));
    },
  };

  return {
    libsqlClient: client,
    embeddings: mockEmbeddings,
    libsqlManager: new MemoryLibsqlManager(),
    admin: {
      apiKey: ulid(),
    },
  };
}

export async function createTestOrganization(
  context: TestContext,
  options?: { plan?: string },
) {
  const id = ulid();
  const apiKey = ulid(); // Generated but unused for auth
  const now = Date.now();
  await context.libsqlClient.execute({
    sql: organizationsAdd,
    args: [
      id,
      "Test Org",
      "Description",
      options?.plan ?? "free",
      apiKey,
      now,
      now,
      null,
    ],
  });
  // Return the admin API key for authentication, as org keys are no longer valid
  return { id, apiKey: context.admin?.apiKey ?? apiKey };
}
