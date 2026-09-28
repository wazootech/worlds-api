PRAGMA foreign_keys = ON;

-- worlds_metadata stores the machine-minted world identity as world_id. The
-- public Worlds API exposes that value as the resource id. namespace is an
-- internal tenancy key and is never exposed publicly.
CREATE TABLE IF NOT EXISTS worlds_metadata (
  world_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'active',
  database_url TEXT,
  database_auth_token TEXT,
  embedding_model TEXT NOT NULL DEFAULT 'tfjs-universal-sentence-encoder',
  chunk_size INTEGER NOT NULL DEFAULT 1000,
  top_k INTEGER NOT NULL DEFAULT 20,
  min_score REAL NOT NULL DEFAULT 0.0,
  delete_time TEXT,
  expire_time TEXT,
  purge_status TEXT NOT NULL DEFAULT 'none',
  purged_at TEXT,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worlds_metadata_namespace
  ON worlds_metadata(namespace);

CREATE INDEX IF NOT EXISTS idx_worlds_metadata_purge
  ON worlds_metadata(purge_status, expire_time)
  WHERE state = 'deleted';

CREATE TABLE IF NOT EXISTS api_keys (
  api_key_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  namespace TEXT NOT NULL,
  world_id TEXT,
  scopes TEXT NOT NULL DEFAULT '["data:read","data:write"]',
  create_time TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash
  ON api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_namespace
  ON api_keys(namespace);

CREATE TABLE IF NOT EXISTS quads (
  quad_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  world_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  graph TEXT NOT NULL DEFAULT 'default',
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_quads_world
  ON quads(namespace, world_id);

CREATE INDEX IF NOT EXISTS idx_quads_subject
  ON quads(subject);

CREATE INDEX IF NOT EXISTS idx_quads_predicate
  ON quads(predicate);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  world_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  source TEXT,
  text TEXT NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_world
  ON chunks(namespace, world_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
  USING fts5(text, content=chunks, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
