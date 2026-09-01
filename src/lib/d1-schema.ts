/**
 * Control-plane D1 schema for worlds-api.
 *
 * RDF quads, search chunks, FTS tables, and their indexes are data-plane
 * objects owned and initialized by @worlds/cloudflare.
 */

/** DDL for the control-plane tables. */
export const CONTROL_PLANE_DDL = [
  `CREATE TABLE IF NOT EXISTS worlds (
    uid TEXT PRIMARY KEY,
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
];

/** @deprecated Data-plane tables are owned by @worlds/cloudflare. */
export const PER_WORLD_DDL: string[] = [];

/** Initializes the control-plane schema. Idempotent and safe at worker startup. */
export async function ensureControlPlaneSchema(db: D1Database): Promise<void> {
  for (const ddl of CONTROL_PLANE_DDL) {
    try {
      await db.prepare(ddl).run();
    } catch {
      // Table/index already exists.
    }
  }
}

/** @deprecated Data-plane schema initialization is performed by the SDK factory. */
export async function ensurePerWorldSchema(_db: D1Database): Promise<void> {
  // Kept as a no-op compatibility shim for existing imports.
}
