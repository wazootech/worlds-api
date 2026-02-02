import { type Client, createClient } from "@libsql/client";
import { ulid } from "@std/ulid";
import { initializeDatabase } from "./db/init.ts";
import { organizationsAdd } from "./db/resources/organizations/queries.sql.ts";
import type { Embeddings } from "./embeddings/embeddings.ts";
// import type { TestContext } from "./testing.ts"; // Removed self-reference

export interface TestContext {
  libsqlClient: Client;
  embeddings: Embeddings;
  admin?: {
    apiKey: string;
  };
}

export async function createTestContext(): Promise<TestContext> {
  const client = createClient({ url: ":memory:" });
  await initializeDatabase(client);

  const mockEmbeddings: Embeddings = {
    dimensions: 768,
    embed: (texts: string | string[]) => {
      const count = Array.isArray(texts) ? texts.length : 1;
      return Promise.resolve(Array(count).fill(Array(768).fill(0)));
    },
  };

  return {
    libsqlClient: client,
    embeddings: mockEmbeddings,
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
