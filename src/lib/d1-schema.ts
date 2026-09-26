const CONTROL_PLANE_DDL = [
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

const ID_COLUMN_MIGRATIONS = [
  { table: "worlds", previous: "uid", current: "world_id" },
  { table: "worlds_metadata", previous: "uid", current: "world_id" },
  { table: "api_keys", previous: "uid", current: "api_key_id" },
];

async function tableColumns(
  db: D1Database,
  table: string,
): Promise<Set<string>> {
  const result = await db
    .prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string }>();
  return new Set(result.results.map((column) => column.name));
}

async function migrateIdentifierColumn(
  db: D1Database,
  migration: (typeof ID_COLUMN_MIGRATIONS)[number],
): Promise<void> {
  const columns = await tableColumns(db, migration.table);
  if (columns.size === 0) return;

  const hasPrevious = columns.has(migration.previous);
  const hasCurrent = columns.has(migration.current);
  if (hasPrevious && hasCurrent) {
    throw new Error(
      `Conflicting identifier columns in ${migration.table}: ${migration.previous} and ${migration.current}`,
    );
  }
  if (!hasPrevious && !hasCurrent) {
    throw new Error(
      `Missing identifier column in ${migration.table}: expected ${migration.current}`,
    );
  }
  if (!hasPrevious) return;

  try {
    await db
      .prepare(
        `ALTER TABLE ${migration.table} RENAME COLUMN ${migration.previous} TO ${migration.current}`,
      )
      .run();
  } catch (error) {
    const currentColumns = await tableColumns(db, migration.table);
    if (
      currentColumns.has(migration.current) &&
      !currentColumns.has(migration.previous)
    ) {
      return;
    }
    throw error;
  }
}

export async function ensureControlPlaneSchema(db: D1Database): Promise<void> {
  for (const ddl of CONTROL_PLANE_DDL) {
    await db.prepare(ddl).run();
  }

  for (const migration of ID_COLUMN_MIGRATIONS) {
    await migrateIdentifierColumn(db, migration);
  }
}

export async function ensurePerWorldSchema(_db: D1Database): Promise<void> {}
