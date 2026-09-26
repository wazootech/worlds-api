PRAGMA foreign_keys = ON;

CREATE TABLE worlds_metadata (
  uid TEXT PRIMARY KEY,
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

CREATE TABLE api_keys (
  uid TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  namespace TEXT NOT NULL,
  world_id TEXT REFERENCES worlds_metadata(uid),
  scopes TEXT NOT NULL DEFAULT '["data:read","data:write"]',
  create_time TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE quads (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds_metadata(uid),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  graph TEXT NOT NULL DEFAULT 'default',
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds_metadata(uid),
  subject TEXT NOT NULL,
  source TEXT,
  text TEXT NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO worlds_metadata (uid, namespace, display_name, state, database_url, create_time, update_time)
VALUES
  ('w_legacy_a', 'account-a', 'Legacy Alpha', 'active', 'd1://alpha', '2026-01-01', '2026-01-02'),
  ('w_legacy_b', 'account-b', 'Legacy Beta', 'deleted', 'd1://beta', '2026-02-01', '2026-02-02');

INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes, create_time, revoked_at)
VALUES
  ('key_legacy_a', 'hash-legacy-a', 'Alpha key', 'account-a', 'w_legacy_a', '["data:read"]', '2026-01-03', NULL),
  ('key_legacy_b', 'hash-legacy-b', 'Namespace key', 'account-b', NULL, '["data:read","data:write"]', '2026-02-03', '2026-02-04');

INSERT INTO quads (id, namespace, world_id, subject, predicate, object, graph)
VALUES
  ('quad_legacy_a', 'account-a', 'w_legacy_a', 'subject-a', 'predicate-a', 'object-a', 'default'),
  ('quad_legacy_b', 'account-b', 'w_legacy_b', 'subject-b', 'predicate-b', 'object-b', 'default');

INSERT INTO chunks (id, namespace, world_id, subject, source, text)
VALUES
  ('chunk_legacy_a', 'account-a', 'w_legacy_a', 'subject-a', 'source-a', 'Alpha chunk'),
  ('chunk_legacy_b', 'account-b', 'w_legacy_b', 'subject-b', 'source-b', 'Beta chunk');
