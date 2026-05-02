import { type Client, createClient } from "@libsql/client";

export interface LibsqlConfig {
  url?: string;
  authToken?: string;
}

/**
 * Create a libsql client from explicit config or environment variables.
 * Falls back to file:./data/worlds.db for local development.
 */
export function createLibsqlClient(config?: LibsqlConfig): Client {
  const url = config?.url ?? Deno.env.get("LIBSQL_URL") ??
    "file:./data/worlds.db";
  const authToken = config?.authToken ??
    Deno.env.get("LIBSQL_AUTH_TOKEN");
  return createClient({ url, authToken });
}
