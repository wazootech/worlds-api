import { createClient, type Client } from "@libsql/client";
import { initializeLibsqlSchema, LibsqlSchemaBuilder } from "@worlds/libsql";
import type { Env } from "../env";
import { getDb, queryOne } from "./db";

export type WorldDatabaseRef = {
  worldUid: string;
  namespace: string;
  databaseUrl: string;
  databaseAuthToken?: string;
  embeddingModel: string;
  chunkSize: number;
  topK: number;
  minScore: number;
};

type WorldDatabaseRow = {
  uid: string;
  namespace: string;
  database_url: string | null;
  database_auth_token: string | null;
  embedding_model: string;
  chunk_size: number;
  top_k: number;
  min_score: number;
};

const clients = new Map<string, Client>();

/**
 * Resolves a world's storage by its canonical world_uid. Only worlds in an
 * active state are reachable by the data plane; suspended or deleted worlds
 * resolve to null and routes reject with NOT_FOUND.
 */
export async function resolveWorldDatabase(
  env: Env,
  worldUid: string,
): Promise<WorldDatabaseRef | null> {
  const row = await queryOne<WorldDatabaseRow>(
    getDb(env),
    "SELECT uid, namespace, database_url, database_auth_token, embedding_model, chunk_size, top_k, min_score FROM worlds_metadata WHERE uid = ? AND state = 'active'",
    [worldUid],
  );
  if (!row?.database_url) return null;
  return {
    worldUid: row.uid,
    namespace: row.namespace,
    databaseUrl: row.database_url,
    databaseAuthToken: row.database_auth_token ?? undefined,
    embeddingModel: row.embedding_model,
    chunkSize: row.chunk_size,
    topK: row.top_k,
    minScore: row.min_score,
  };
}

export function worldDb(ref: WorldDatabaseRef): Client {
  const key = `${ref.databaseUrl}\n${ref.databaseAuthToken ?? ""}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = createClient({
    url: ref.databaseUrl,
    authToken: ref.databaseAuthToken,
  });
  clients.set(key, client);
  return client;
}

export async function initializeWorldDatabase(ref: WorldDatabaseRef) {
  const db = worldDb(ref);
  await initializeLibsqlSchema(db, new LibsqlSchemaBuilder(32));
}
