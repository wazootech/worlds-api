PRAGMA foreign_keys = ON;

CREATE TABLE worlds (
  uid TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);

CREATE TABLE worlds_metadata (
  uid TEXT PRIMARY KEY REFERENCES worlds(uid),
  database_url TEXT,
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

CREATE TABLE quads (
  id TEXT PRIMARY KEY,
  world_uid TEXT NOT NULL REFERENCES worlds(uid),
  payload TEXT NOT NULL
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  world_uid TEXT NOT NULL REFERENCES worlds(uid),
  quad_id TEXT NOT NULL REFERENCES quads(id),
  content TEXT NOT NULL
);

INSERT INTO worlds (uid, namespace, display_name, create_time, update_time)
VALUES
  ('w_alpha', 'ns_alpha', 'Alpha', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('w_beta', 'ns_beta', 'Beta', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z');

INSERT INTO worlds_metadata (uid, database_url, create_time)
VALUES ('w_alpha', 'd1://alpha', '2026-01-01T00:00:00Z');

INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes, create_time)
VALUES
  ('key_alpha', 'hash-alpha', 'Alpha key', 'ns_alpha', 'w_alpha', '["data:read"]', '2026-01-03T00:00:00Z'),
  ('key_beta', 'hash-beta', 'Beta key', 'ns_beta', 'w_beta', '["data:read","data:write"]', '2026-02-03T00:00:00Z'),
  ('key_namespace', 'hash-namespace', 'Namespace key', 'ns_alpha', NULL, '["data:read"]', '2026-01-04T00:00:00Z');

INSERT INTO quads (id, world_uid, payload)
VALUES ('quad_alpha', 'w_alpha', 'alpha quad'), ('quad_beta', 'w_beta', 'beta quad');

INSERT INTO chunks (id, world_uid, quad_id, content)
VALUES ('chunk_alpha', 'w_alpha', 'quad_alpha', 'alpha chunk'), ('chunk_beta', 'w_beta', 'quad_beta', 'beta chunk');
