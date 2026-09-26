PRAGMA foreign_keys = ON;

CREATE TABLE worlds (
  uid TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  embedding_model TEXT NOT NULL,
  chunk_size INTEGER NOT NULL,
  top_k INTEGER NOT NULL,
  min_score REAL NOT NULL,
  delete_time TEXT,
  expire_time TEXT,
  purge_status TEXT NOT NULL,
  purged_at TEXT,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);

CREATE INDEX idx_worlds_namespace ON worlds(namespace, state);

CREATE TABLE worlds_metadata (
  uid TEXT PRIMARY KEY REFERENCES worlds(uid),
  database_url TEXT,
  database_auth_token TEXT,
  create_time TEXT NOT NULL
);

CREATE TABLE api_keys (
  uid TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  namespace TEXT NOT NULL,
  world_id TEXT REFERENCES worlds(uid),
  scopes TEXT NOT NULL,
  create_time TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_api_keys_namespace ON api_keys(namespace);

CREATE TABLE quads (
  id TEXT PRIMARY KEY,
  world_uid TEXT NOT NULL REFERENCES worlds(uid),
  subject TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  world_uid TEXT NOT NULL REFERENCES worlds(uid),
  quad_id TEXT NOT NULL REFERENCES quads(id),
  text TEXT NOT NULL
);

INSERT INTO worlds VALUES
  ('w_alpha', 'namespace-a', 'Alpha', 'active', 'model-a', 400, 10, 0.1, NULL, NULL, 'none', NULL, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
  ('w_beta', 'namespace-b', 'Beta', 'deleted', 'model-b', 500, 12, 0.2, '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 'pending', NULL, '2026-01-03T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

INSERT INTO worlds_metadata VALUES
  ('w_alpha', 'd1://alpha', 'credential-alpha', '2026-01-01T00:00:00.000Z'),
  ('w_beta', 'd1://beta', 'credential-beta', '2026-01-03T00:00:00.000Z');

INSERT INTO api_keys VALUES
  ('key-alpha', 'hash-alpha', 'Alpha key', 'namespace-a', 'w_alpha', '["data:read"]', '2026-01-04T00:00:00.000Z', NULL),
  ('key-beta', 'hash-beta', 'Beta key', 'namespace-b', 'w_beta', '["data:read","data:write"]', '2026-01-05T00:00:00.000Z', NULL),
  ('key-wide', 'hash-wide', 'Namespace key', 'namespace-a', NULL, '["data:read"]', '2026-01-06T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

INSERT INTO quads VALUES
  ('quad-alpha', 'w_alpha', 'https://example.test/alpha', 'alpha payload'),
  ('quad-beta', 'w_beta', 'https://example.test/beta', 'beta payload');

INSERT INTO chunks VALUES
  ('chunk-alpha', 'w_alpha', 'quad-alpha', 'Alpha chunk'),
  ('chunk-beta', 'w_beta', 'quad-beta', 'Beta chunk');
