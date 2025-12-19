import { type Client, createClient } from "@libsql/client";
export type { Client };

/**
 * openDatabase opens a SQLite database using LibSQL client.
 */
export async function openDatabase(path: string): Promise<Client> {
  const url = path === ":memory:" ? ":memory:" : `file:${path}`;
  const client = createClient({
    url,
  });

  // Enable foreign keys
  await client.execute("PRAGMA foreign_keys = ON;");

  // Recursive triggers for cascading deletes (e.g. blank nodes)
  await client.execute("PRAGMA recursive_triggers = ON;");

  return client;
}
