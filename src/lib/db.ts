import {
  type Client as LibsqlClient,
  createClient,
  type InArgs,
} from "@libsql/client";
import type { Env } from "../env";

let client: LibsqlClient | null = null;
let clientKey = "";

export function getDb(env: Env): LibsqlClient {
  const key = `${env.LIBSQL_URL}\n${env.LIBSQL_AUTH_TOKEN ?? ""}`;
  if (client && clientKey === key) return client;
  client = createClient({
    url: env.LIBSQL_URL,
    authToken: env.LIBSQL_AUTH_TOKEN,
  });
  clientKey = key;
  return client;
}

export async function query<T>(
  db: LibsqlClient,
  sql: string,
  args?: InArgs,
): Promise<T[]> {
  const rs = await db.execute({ sql, args });
  return rs.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < rs.columns.length; i++) {
      obj[rs.columns[i]] = row[i];
    }
    return obj as T;
  });
}

export async function queryOne<T>(
  db: LibsqlClient,
  sql: string,
  args?: InArgs,
): Promise<T | null> {
  const rs = await db.execute({ sql, args });
  if (rs.rows.length === 0) return null;
  const row = rs.rows[0];
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < rs.columns.length; i++) {
    obj[rs.columns[i]] = row[i];
  }
  return obj as T;
}

export async function execute(
  db: LibsqlClient,
  sql: string,
  args?: InArgs,
): Promise<{ rowsAffected: number }> {
  const rs = await db.execute({ sql, args });
  return { rowsAffected: rs.rowsAffected };
}

export function uid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
