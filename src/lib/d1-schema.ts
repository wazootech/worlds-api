/**
 * D1 schema for the worlds-api.
 *
 * The single D1 database holds both control-plane tables (worlds, api_keys)
 * and per-world data tables (quads, chunks, chunks_fts). Per-world tables
 * carry a `world_uid` column for logical separation.
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

/** DDL for per-world data tables (quads, chunks, FTS5). */
export const PER_WORLD_DDL = [
  // 10-column quads table matching @worlds/cloudflare's D1 schema
  `CREATE TABLE IF NOT EXISTS quads (
    id TEXT PRIMARY KEY,
    s TEXT NOT NULL,
    s_type TEXT NOT NULL,
    p TEXT NOT NULL,
    o TEXT NOT NULL,
    o_type TEXT NOT NULL,
    o_datatype TEXT,
    o_lang TEXT,
    g TEXT NOT NULL,
    g_type TEXT NOT NULL,
    world_uid TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quads_spog ON quads(s, p, o, g)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_sopg ON quads(s, o, p, g)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_pso ON quads(p, s, o)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_pos ON quads(p, o, s)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_ospg ON quads(o, s, p, g)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_opsg ON quads(o, p, s, g)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_gpso ON quads(g, p, s, o)`,
  `CREATE INDEX IF NOT EXISTS idx_quads_world ON quads(world_uid)`,
  // Chunks table for search content
  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quad_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    graph TEXT NOT NULL,
    value TEXT NOT NULL,
    fts_value TEXT NOT NULL,
    vector F32_BLOB(1536),
    world_uid TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_quad_id ON chunks(quad_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_world ON chunks(world_uid)`,
];

/**
 * Initializes the control-plane schema. Idempotent — safe to call on every
 * worker startup.
 */
export async function ensureControlPlaneSchema(db: D1Database): Promise<void> {
  for (const ddl of CONTROL_PLANE_DDL) {
    try {
      await db.prepare(ddl).run();
    } catch {
      // Table/index already exists — ignore
    }
  }
}

/**
 * Initializes per-world data tables. Idempotent. Called once for the shared
 * database — the `world_uid` column provides logical separation.
 */
export async function ensurePerWorldSchema(db: D1Database): Promise<void> {
  for (const ddl of PER_WORLD_DDL) {
    try {
      await db.prepare(ddl).run();
    } catch {
      // Table/index already exists — ignore
    }
  }
  // FTS5 external-content table
  try {
    await db
      .prepare(
        `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(fts_value, world_uid UNINDEXED, quad_id UNINDEXED)`,
      )
      .run();
  } catch {
    // FTS5 table may already exist — ignore
  }
}
