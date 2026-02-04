-- worldDataTable is a singleton table to store the world's blob.
-- id=1 is enforced to ensure it's a singleton.
CREATE TABLE IF NOT EXISTS world_data (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  blob BLOB,
  updated_at INTEGER NOT NULL
);

-- selectWorldData fetches the singleton world data.
SELECT
  blob,
  updated_at
FROM
  world_data
WHERE
  id = 1;

-- upsertWorldData inserts or updates the singleton world data.
INSERT INTO
  world_data (id, blob, updated_at)
VALUES
  (1, ?, ?) ON CONFLICT(id) DO
UPDATE
SET
  blob = excluded.blob,
  updated_at = excluded.updated_at;
