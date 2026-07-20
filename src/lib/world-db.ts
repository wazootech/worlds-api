import { createClient, type Client } from "@libsql/client";
import { initializeLibsqlSchema, LibsqlSchemaBuilder } from "@worlds/libsql";
import type { Env } from "../env";
import { getDb, queryOne } from "./db";

export type WorldDatabaseRef = {
  namespace: string;
  worldId: string;
  databaseUrl: string;
  databaseAuthToken?: string;
};

type WorldDatabaseRow = {
  namespace: string;
  world_id: string;
  database_url: string | null;
  database_auth_token: string | null;
};

const clients = new Map<string, Client>();

export async function resolveWorldDatabase(
  env: Env,
  namespace: string,
  worldId: string,
): Promise<WorldDatabaseRef | null> {
  const row = await queryOne<WorldDatabaseRow>(
    getDb(env),
    "SELECT namespace, world_id, database_url, database_auth_token FROM worlds_metadata WHERE namespace = ? AND world_id = ? AND state != 'deleted'",
    [namespace, worldId],
  );
  if (!row?.database_url) return null;
  return {
    namespace: row.namespace,
    worldId: row.world_id,
    databaseUrl: row.database_url,
    databaseAuthToken: row.database_auth_token ?? undefined,
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
