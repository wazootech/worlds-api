import type { Client } from "@libsql/client";
import type { Embeddings } from "./embeddings/embeddings.ts";
import type { LibsqlManager } from "./db/manager.ts";

/**
 * AppContext is shared by every route.
 */
export interface AppContext {
  libsqlClient: Client;
  libsqlManager?: LibsqlManager;
  embeddings: Embeddings;
  admin?: {
    apiKey: string;
  };
}
