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

const CONTROL_PLANE_COLUMNS = {
  worlds: [
    "world_id",
    "namespace",
    "display_name",
    "state",
    "embedding_model",
    "chunk_size",
    "top_k",
    "min_score",
    "delete_time",
    "expire_time",
    "purge_status",
    "purged_at",
    "create_time",
    "update_time",
  ],
  api_keys: [
    "api_key_id",
    "key_hash",
    "name",
    "namespace",
    "world_id",
    "scopes",
    "create_time",
    "revoked_at",
  ],
} as const;

export async function ensureControlPlaneSchema(db: D1Database): Promise<void> {
  for (const ddl of CONTROL_PLANE_DDL) {
    try {
      await db.prepare(ddl).run();
    } catch (error) {
      console.error("Control-plane schema DDL failed", { ddl, error });
      throw error;
    }
  }
}

export async function assertControlPlaneSchema(db: D1Database): Promise<void> {
  for (const [table, expectedColumns] of Object.entries(
    CONTROL_PLANE_COLUMNS,
  )) {
    const result = await db.prepare(`PRAGMA table_info('${table}')`).all<{
      name: string;
    }>();
    const actualColumns = new Set(
      (result.results ?? []).map((column) => column.name),
    );
    const missingColumns = expectedColumns.filter(
      (column) => !actualColumns.has(column),
    );
    if (missingColumns.length > 0) {
      throw new Error(
        `Control-plane schema mismatch in ${table}: missing ${missingColumns.join(", ")}`,
      );
    }
  }
}
