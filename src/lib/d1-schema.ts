import type { D1Database } from "@cloudflare/workers-types";

/**
 * Control-plane D1 schema for worlds-api.
 *
 * RDF quads, search chunks, FTS tables, and their indexes are data-plane
 * objects owned and initialized by @worlds/cloudflare.
 */
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
    uid TEXT PRIMARY KEY,
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
] as const;

const REQUIRED_COLUMNS = {
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
    "uid",
    "key_hash",
    "name",
    "namespace",
    "world_id",
    "scopes",
    "create_time",
    "revoked_at",
  ],
} as const;

const REQUIRED_PRIMARY_KEYS = {
  worlds: "world_id",
  api_keys: "uid",
} as const;

const FORBIDDEN_COLUMNS = {
  worlds: ["uid", "worlds_api_uid", "slug"],
  api_keys: ["world_uid"],
} as const;

/** Initializes the control-plane schema and fails visibly if D1 rejects DDL. */
export async function ensureControlPlaneSchema(db: D1Database): Promise<void> {
  for (const ddl of CONTROL_PLANE_DDL) {
    try {
      await db.prepare(ddl).run();
    } catch (error) {
      console.error("Worlds API control-plane DDL failed", { ddl, error });
      throw error;
    }
  }
}

/** Checks the control-plane columns and primary keys used by this API. */
export async function assertControlPlaneSchema(db: D1Database): Promise<void> {
  for (const table of Object.keys(REQUIRED_COLUMNS) as Array<
    keyof typeof REQUIRED_COLUMNS
  >) {
    const result = await db
      .prepare(`PRAGMA table_info('${table}')`)
      .all<{ name: string; pk: number }>();
    const rows = result.results ?? [];
    const names = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_COLUMNS[table].filter(
      (column) => !names.has(column),
    );
    const primaryKeys = rows.filter((row) => Number(row.pk) > 0);
    const details: string[] = [];
    const forbidden = FORBIDDEN_COLUMNS[table].filter((column) =>
      names.has(column),
    );

    if (rows.length === 0) details.push("table is missing");
    if (missing.length > 0)
      details.push(`missing columns: ${missing.join(", ")}`);
    if (forbidden.length > 0)
      details.push(`legacy columns present: ${forbidden.join(", ")}`);

    const primaryKey = REQUIRED_PRIMARY_KEYS[table];
    if (primaryKeys.length !== 1 || primaryKeys[0]?.name !== primaryKey) {
      const found = primaryKeys.map((row) => row.name).join(", ") || "none";
      details.push(`expected primary key ${primaryKey}, found ${found}`);
    }

    if (details.length > 0) {
      throw new Error(
        `Control-plane schema mismatch for ${table}: ${details.join("; ")}`,
      );
    }
  }
}

/** @deprecated Data-plane tables are owned by @worlds/cloudflare. */
export const PER_WORLD_DDL: string[] = [];

/** @deprecated Data-plane schema initialization is performed by the SDK factory. */
export async function ensurePerWorldSchema(_db: D1Database): Promise<void> {}
