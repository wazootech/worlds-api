import type { D1Database } from "@cloudflare/workers-types";

export const CONTROL_PLANE_DDL = [
  `CREATE TABLE IF NOT EXISTS worlds (
    world_id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    display_name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    embedding_model TEXT NOT NULL DEFAULT 'tfjs-universal-sentence-encoder',
    chunk_size INTEGER NOT NULL DEFAULT 400,
    top_k INTEGER NOT NULL DEFAULT 10,
    min_score REAL NOT NULL DEFAULT 0.0,
    delete_time TEXT,
    expire_time TEXT,
    purge_status TEXT NOT NULL DEFAULT 'none',
    purged_at TEXT,
    create_time TEXT NOT NULL DEFAULT (datetime('now')),
    update_time TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worlds_namespace ON worlds(namespace, state)`,
  `CREATE INDEX IF NOT EXISTS idx_worlds_purge ON worlds(state, purge_status, expire_time)`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    api_key_id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    namespace TEXT NOT NULL,
    world_id TEXT,
    scopes TEXT NOT NULL DEFAULT '["data:read","data:write"]',
    create_time TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_namespace ON api_keys(namespace) WHERE revoked_at IS NULL`,
];

const REQUIRED_IDENTITY_COLUMNS = {
  worlds: ["world_id"],
  api_keys: ["api_key_id", "world_id"],
};

export async function assertCanonicalControlPlaneSchema(
  db: D1Database,
): Promise<void> {
  for (const [table, requiredColumns] of Object.entries(
    REQUIRED_IDENTITY_COLUMNS,
  )) {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all<{
      name: string;
    }>();
    const actual = new Set(result.results.map((column) => column.name));
    const missing = requiredColumns.filter((column) => !actual.has(column));
    if (missing.length) {
      throw new Error(
        `D1 identity schema is incomplete for ${table}: missing ${missing.join(", ")}. Apply the platform ID migration before serving requests.`,
      );
    }
  }
}

export async function ensureControlPlaneSchema(db: D1Database): Promise<void> {
  const existing = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('worlds', 'api_keys')",
    )
    .all<{ name: string }>();

  if (existing.results.length) {
    await assertCanonicalControlPlaneSchema(db);
  }

  for (const ddl of CONTROL_PLANE_DDL) {
    await db.prepare(ddl).run();
  }

  await assertCanonicalControlPlaneSchema(db);
}

export const PER_WORLD_DDL: string[] = [];

export async function ensurePerWorldSchema(_db: D1Database): Promise<void> {}
