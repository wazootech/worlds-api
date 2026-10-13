import type { D1Database } from "@cloudflare/workers-types";

/**
 * Control-plane D1 schema for worlds-api.
 *
 * RDF quads, search chunks, FTS tables, and their indexes are data-plane
 * objects owned and initialized by @worlds/cloudflare.
 */
export const CONTROL_PLANE_DDL = [
  `CREATE TABLE IF NOT EXISTS worlds (
    world_id TEXT NOT NULL PRIMARY KEY,
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
  // BYOK embeddings (worlds-api#1). New tables only, so the existing
  // CREATE TABLE IF NOT EXISTS mechanism applies them with no reset or ALTER.
  // One credential per (namespace, provider). ciphertext/iv are NULL once
  // revoked. kek_version selects which EMBEDDING_KEK_V<n> secret opens it.
  `CREATE TABLE IF NOT EXISTS embedding_credentials (
    credential_id TEXT NOT NULL PRIMARY KEY,
    namespace TEXT NOT NULL,
    provider TEXT NOT NULL,
    ciphertext TEXT,
    iv TEXT,
    kek_version INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    last4 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    consecutive_auth_failures INTEGER NOT NULL DEFAULT 0,
    create_time TEXT NOT NULL,
    rotate_time TEXT,
    revoke_time TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_credentials_ns_provider ON embedding_credentials(namespace, provider)`,
  // Per-world index state: which model the world's vectors were built with and
  // whether they are usable. A missing row means "never indexed" (stale).
  // reindex_cursor is the last subject a windowed reindex finished; NULL when
  // no multi-call reindex pass is in progress.
  `CREATE TABLE IF NOT EXISTS world_embedding_state (
    world_id TEXT NOT NULL PRIMARY KEY,
    state TEXT NOT NULL,
    model TEXT NOT NULL,
    update_time TEXT NOT NULL,
    reindex_cursor TEXT
  )`,
  // Daily per-namespace spend counters (texts embedded), reserved atomically
  // before the provider is called.
  `CREATE TABLE IF NOT EXISTS embedding_usage (
    namespace TEXT NOT NULL,
    day TEXT NOT NULL,
    units INTEGER NOT NULL DEFAULT 0,
    index_units INTEGER NOT NULL DEFAULT 0,
    query_units INTEGER NOT NULL DEFAULT 0,
    update_time TEXT NOT NULL,
    PRIMARY KEY (namespace, day)
  )`,
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
  embedding_credentials: [
    "credential_id",
    "namespace",
    "provider",
    "ciphertext",
    "iv",
    "kek_version",
    "fingerprint",
    "last4",
    "status",
    "consecutive_auth_failures",
    "create_time",
    "rotate_time",
    "revoke_time",
  ],
  world_embedding_state: [
    "world_id",
    "state",
    "model",
    "update_time",
    "reindex_cursor",
  ],
} as const;

const REQUIRED_PRIMARY_KEYS = {
  worlds: "world_id",
  api_keys: "uid",
  embedding_credentials: "credential_id",
  world_embedding_state: "world_id",
} as const;

const FORBIDDEN_COLUMNS = {
  worlds: ["uid", "worlds_api_uid", "slug"],
  api_keys: ["world_uid"],
  embedding_credentials: [],
  world_embedding_state: [],
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
      .all<{ name: string; pk: number; notnull: number }>();
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
    if (
      table === "worlds" &&
      Number(rows.find((row) => row.name === "world_id")?.notnull) !== 1
    ) {
      details.push("world_id must be NOT NULL");
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
