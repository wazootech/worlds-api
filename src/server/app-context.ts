import type { Client } from "@libsql/client";
import type { Embeddings } from "./embeddings/embeddings.ts";
import type { DatabaseManager } from "./database-manager/database-manager.ts";

/**
 * AppContext is shared by every route.
 */
export interface AppContext {
  database: Client;
  databaseManager: DatabaseManager;
  embeddings: Embeddings;
  admin?: {
    apiKey: string;
  };
}
