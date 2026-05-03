import type { Client } from "@libsql/client";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { Worlds } from "./worlds.ts";
import type { WorldStorage } from "./storage/interface.ts";
import { LibsqlWorldStorage } from "./storage/libsql.ts";
import type { QuadStorageManager } from "#/rdf/storage/quad-storage.ts";
import { LibsqlQuadStorageManager } from "#/rdf/storage/libsql-quad-storage-manager.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import { LibsqlChunkIndexManager } from "#/indexing/storage/libsql.ts";
import { createLibsqlClient } from "./storage/libsql-client.ts";

export interface WorldsFactoryConfig {
  /** libsql URL: "file:./path.db" or "libsql://..." */
  url?: string;
  /** Auth token for remote Turso connections */
  authToken?: string;
  /** Override the libsql client instance directly */
  client?: Client;
  /** Embeddings service (defaults to FakeEmbeddingsService) */
  embeddings?: EmbeddingsService;
}

/**
 * Create a Worlds instance wired with libsql/Turso persistent storage.
 *
 * Usage:
 * ```typescript
 * // Local file-based (default: file:./data/worlds.db)
 * const worlds = createWorldsWithLibsql();
 *
 * // Custom file path
 * const worlds = createWorldsWithLibsql({ url: "file:./my.db" });
 *
 * // Remote Turso
 * const worlds = createWorldsWithLibsql({
 *   url: "libsql://my-db.turso.io",
 *   authToken: "my-token",
 * });
 * ```
 */
export function createWorldsWithLibsql(config?: WorldsFactoryConfig): Worlds {
  const client = config?.client ??
    createLibsqlClient({
      url: config?.url,
      authToken: config?.authToken,
    });

  const worldStorage: WorldStorage = new LibsqlWorldStorage(client);
  const quadStorageManager: QuadStorageManager = new LibsqlQuadStorageManager(
    client,
  );
  const chunkIndexManager: ChunkIndexManager = new LibsqlChunkIndexManager(
    client,
  );
  const embeddings = config?.embeddings ?? new FakeEmbeddingsService();

  return new Worlds({
    worldStorage,
    quadStorageManager,
    chunkIndexManager,
    embeddings,
  });
}
