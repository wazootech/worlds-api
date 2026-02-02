-- factsTable is a table for facts with vector embeddings.
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  property TEXT NOT NULL,
  value TEXT NOT NULL,
  vector F32_BLOB(1536),
  UNIQUE(item_id, property, value)
);

-- factsItemIdIndex is an index on item_id for efficient filtering.
CREATE INDEX IF NOT EXISTS idx_facts_item_id ON facts(item_id);

-- factsPropertyIndex is an index on property for efficient filtering.
CREATE INDEX IF NOT EXISTS idx_facts_property ON facts(property);

-- factsVectorIndex is a vector index for similarity search.
CREATE INDEX IF NOT EXISTS idx_facts_vector ON facts(libsql_vector_idx(vector));

-- factsFtsTable is an FTS5 virtual table for full-text search.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  value,
  content = 'facts',
  content_rowid = 'rowid'
);

-- factsFtsInsertTrigger is a trigger to sync FTS after insert.
CREATE TRIGGER IF NOT EXISTS facts_ai
AFTER
INSERT
  ON facts
BEGIN
INSERT INTO
  facts_fts(rowid, value)
VALUES
  (new.rowid, new.value);

END;

-- factsFtsDeleteTrigger is a trigger to sync FTS after delete.
CREATE TRIGGER IF NOT EXISTS facts_ad
AFTER
  DELETE ON facts
BEGIN
INSERT INTO
  facts_fts(facts_fts, rowid, value)
VALUES
  ('delete', old.rowid, old.value);

END;

-- factsFtsUpdateTrigger is a trigger to sync FTS after update.
CREATE TRIGGER IF NOT EXISTS facts_au
AFTER
UPDATE
  ON facts
BEGIN
INSERT INTO
  facts_fts(facts_fts, rowid, value)
VALUES
  ('delete', old.rowid, old.value);

INSERT INTO
  facts_fts(rowid, value)
VALUES
  (new.rowid, new.value);

END;

-- deleteFacts is a query that deletes a specific fact by id.
DELETE FROM
  facts
WHERE
  id = ?;

-- upsertFacts is a query that inserts or replaces a fact with
-- embedding.
INSERT
  OR REPLACE INTO facts (
    id,
    item_id,
    property,
    value,
    vector
  )
VALUES
  (?, ?, ?, ?, vector32(?));

-- searchFacts is a query that performs hybrid search using RRF
-- (Reciprocal Rank Fusion) combining FTS and vector search.
-- Supports optional filtering by item_id and property.
WITH vec_matches AS (
  SELECT
    id AS rowid,
    row_number() OVER (PARTITION BY NULL) AS rank_number
  FROM
    vector_top_k('idx_facts_vector', vector32(?), ?)
),
fts_matches AS (
  SELECT
    rowid,
    row_number() OVER (
      ORDER BY
        rank
    ) AS rank_number,
    rank AS score
  FROM
    facts_fts
  WHERE
    facts_fts MATCH ?
  LIMIT
    ?
), final AS (
  SELECT
    facts.item_id,
    facts.property,
    facts.value,
    vec_matches.rank_number AS vec_rank,
    fts_matches.rank_number AS fts_rank,
    (
      COALESCE(1.0 / (60 + fts_matches.rank_number), 0.0) * 1.0 + COALESCE(1.0 / (60 + vec_matches.rank_number), 0.0) * 1.0
    ) AS combined_rank
  FROM
    fts_matches
    FULL OUTER JOIN vec_matches ON vec_matches.rowid = fts_matches.rowid
    JOIN facts ON facts.rowid = COALESCE(fts_matches.rowid, vec_matches.rowid)
  WHERE
    (
      ? IS NULL
      OR facts.item_id IN (
        SELECT
          value
        FROM
          json_each(?)
      )
    )
    AND (
      ? IS NULL
      OR facts.property IN (
        SELECT
          value
        FROM
          json_each(?)
      )
    )
  ORDER BY
    combined_rank DESC
  LIMIT
    ?
)
SELECT
  *
FROM
  final;
