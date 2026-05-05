import { type Client } from "@libsql/client";
import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
} from "./interface.ts";
import type { ChunkIndexState, ChunkRecord, ChunkSearchRow } from "./types.ts";
import { ftsTermHits } from "#/indexing/fts.ts";
import { buildSubjectTypes, filterItems, scoreItem } from "../ranking.ts";

function serializeVector(v: Float32Array | number[]): string {
  return JSON.stringify(Array.from(v));
}

function deserializeVector(value: unknown): Float32Array {
  if (value instanceof Uint8Array) {
    return new Float32Array(value.buffer);
  }
  if (value instanceof ArrayBuffer) {
    return new Float32Array(value);
  }
  try {
    return new Float32Array(JSON.parse(value as string));
  } catch (e) {
    throw new Error(`Failed to deserialize vector: ${(e as Error).message}`);
  }
}

// ── LibsqlChunkIndex ───────────────────────────────────────────────────────

export class LibsqlChunkIndex implements ChunkIndex {
  constructor(
    private readonly client: Client,
    private readonly world: WorldReference,
    private readonly dimensions: number,
  ) {}

  async setChunk(chunk: ChunkRecord): Promise<void> {
    await this.ensureInitialized();
    const ns = chunk.world.namespace ?? "_";
    const vectorSql = this.vectorSupported ? `vector32(?)` : `?`;
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO chunks
            (id, world_namespace, world_id, quad_id, subject, predicate, text, vector)
            VALUES (?, ?, ?, ?, ?, ?, ?, ${vectorSql})`,
      args: [
        chunk.id,
        ns,
        chunk.world.id,
        chunk.quadId,
        chunk.subject,
        chunk.predicate,
        chunk.text,
        serializeVector(chunk.vector),
      ],
    });
  }

  async deleteChunk(quadId: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `DELETE FROM chunks WHERE quad_id = ?`,
      args: [quadId],
    });
  }

  async getAll(): Promise<ChunkRecord[]> {
    return this.getFiltered({});
  }

  private async getFiltered(
    input: Partial<ChunkIndexSearchQuery>,
  ): Promise<ChunkRecord[]> {
    await this.ensureInitialized();
    const ns = this.world.namespace ?? "_";

    let sql = `SELECT * FROM chunks WHERE world_namespace = ? AND world_id = ?`;
    const args: (string | number)[] = [ns, this.world.id];

    if (input.subjects?.length) {
      const placeholders = input.subjects.map(() => "?").join(", ");
      sql += ` AND subject IN (${placeholders})`;
      args.push(...input.subjects);
    }
    if (input.predicates?.length) {
      const placeholders = input.predicates.map(() => "?").join(", ");
      sql += ` AND predicate IN (${placeholders})`;
      args.push(...input.predicates);
    }

    const result = await this.client.execute({ sql, args });
    return result.rows.map((row) => this.rowToChunk(row));
  }

  async search(input: ChunkIndexSearchQuery): Promise<ChunkSearchRow[]> {
    await this.ensureInitialized();

    if (!this.vectorSupported) {
      // Fallback to in-memory scoring if native vector search is not available
      const chunks = input.types?.length
        ? await this.getAll()
        : await this.getFiltered(input);

      const subjectTypes = buildSubjectTypes(chunks);
      const filtered = filterItems({
        items: chunks,
        subjects: input.subjects,
        predicates: input.predicates,
        types: input.types,
        subjectTypes,
      });

      const rows: ChunkSearchRow[] = [];
      for (const chunk of filtered) {
        const result = scoreItem({
          item: chunk,
          queryTerms: input.queryTerms,
          queryText: input.queryText,
          queryVector: input.queryVector,
          ftsTermHits,
        });
        if (result) rows.push(result);
      }

      rows.sort((a, b) => b.score - a.score);
      return rows;
    }

    const ns = this.world.namespace ?? "_";
    const mode = input.mode ?? "hybrid";
    const weights = input.weights ?? { vector: 1.0, fts: 1.0 };
    const limit = 100;

    const queryVectorJson = serializeVector(input.queryVector);

    let sql = "";
    const args: (string | number)[] = [];

    if (mode === "fts") {
      sql = `
        SELECT 
          chunks.*,
          NULL as vec_rank,
          rank as fts_rank,
          rank as score
        FROM chunks_fts
        JOIN chunks ON chunks.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
          AND chunks.world_namespace = ? AND chunks.world_id = ?
        ORDER BY rank
        LIMIT ?
      `;
      args.push(input.queryText, ns, this.world.id, limit);
    } else if (mode === "vector") {
      sql = `
        SELECT 
          chunks.*,
          row_number() OVER (PARTITION BY NULL) as vec_rank,
          NULL as fts_rank,
          1.0 / (60 + row_number() OVER (PARTITION BY NULL)) as score
        FROM vector_top_k('idx_chunks_vector', vector32(?), ?)
        JOIN chunks ON chunks.rowid = id
        WHERE chunks.world_namespace = ? AND chunks.world_id = ?
        LIMIT ?
      `;
      args.push(queryVectorJson, limit, ns, this.world.id, limit);
    } else {
      // hybrid (RRF)
      sql = `
        WITH vec_matches AS (
          SELECT
            id AS rowid,
            row_number() OVER (PARTITION BY NULL) AS rank_number
          FROM
            vector_top_k('idx_chunks_vector', vector32(?), ?)
        ),
        fts_matches AS (
          SELECT
            rowid,
            row_number() OVER (ORDER BY rank) AS rank_number
          FROM
            chunks_fts
          WHERE
            chunks_fts MATCH ?
          LIMIT ?
        )
        SELECT
          chunks.*,
          vec_matches.rank_number as vec_rank,
          fts_matches.rank_number as fts_rank,
          (
            COALESCE(1.0 / (60 + fts_matches.rank_number), 0.0) * ? + 
            COALESCE(1.0 / (60 + vec_matches.rank_number), 0.0) * ?
          ) AS score
        FROM
          fts_matches
          FULL OUTER JOIN vec_matches ON vec_matches.rowid = fts_matches.rowid
          JOIN chunks ON chunks.rowid = COALESCE(fts_matches.rowid, vec_matches.rowid)
        WHERE chunks.world_namespace = ? AND chunks.world_id = ?
        ORDER BY
          score DESC
        LIMIT ?
      `;
      args.push(
        queryVectorJson,
        limit,
        input.queryText,
        limit,
        weights.fts,
        weights.vector,
        ns,
        this.world.id,
        limit,
      );
    }

    // Add filters if any
    // Note: In RRF mode, we currently apply filters AFTER the ranking to keep SQL manageable.
    // For large indices, we should push these into the CTEs.
    if (input.subjects?.length || input.predicates?.length) {
      // We wrap the above in a subquery to apply filters
      sql = `SELECT * FROM (${sql}) AS filtered WHERE 1=1`;
      if (input.subjects?.length) {
        const p = input.subjects.map(() => "?").join(", ");
        sql += ` AND subject IN (${p})`;
        args.push(...input.subjects);
      }
      if (input.predicates?.length) {
        const p = input.predicates.map(() => "?").join(", ");
        sql += ` AND predicate IN (${p})`;
        args.push(...input.predicates);
      }
    }

    const result = await this.client.execute({ sql, args });
    const chunks = result.rows.map((row) => this.rowToChunk(row));

    // Handle types filtering (still in JS for now as it requires scanning all quads)
    if (input.types?.length) {
      const subjectTypes = buildSubjectTypes(chunks);
      const filtered = filterItems({
        items: chunks,
        subjects: input.subjects,
        predicates: input.predicates,
        types: input.types,
        subjectTypes,
      });
      return filtered.map((c, i) => {
        const row = result.rows[i] as Record<string, unknown>;
        return {
          subject: c.subject,
          predicate: c.predicate,
          object: c.text, // TODO: Store object separately from text if needed
          vecRank: row.vec_rank as number | null,
          ftsRank: row.fts_rank as number | null,
          score: row.score as number,
          world: this.world,
        };
      });
    }

    return result.rows.map((row) => ({
      subject: row.subject as string,
      predicate: row.predicate as string,
      object: row.text as string,
      vecRank: row.vec_rank as number | null,
      ftsRank: row.fts_rank as number | null,
      score: row.score as number,
      world: this.world,
    }));
  }

  private initialized = false;
  private vectorSupported = true;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.client.execute(`PRAGMA foreign_keys = ON;`);
    // Ensure parent table exists
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS worlds (
        namespace TEXT NOT NULL,
        id TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        create_time INTEGER NOT NULL,
        PRIMARY KEY (namespace, id)
      )
    `);
    // Detect if native vector search is supported by trying to create the table with F32_BLOB
    try {
      await this.client.execute(`
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT NOT NULL PRIMARY KEY,
          world_namespace TEXT NOT NULL,
          world_id TEXT NOT NULL,
          quad_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          text TEXT NOT NULL,
          vector F32_BLOB(${this.dimensions}),
          FOREIGN KEY (world_namespace, world_id) REFERENCES worlds (namespace, id) ON DELETE CASCADE
        )
      `);
      this.vectorSupported = true;
    } catch (e) {
      this.vectorSupported = false;
      console.warn("Native F32_BLOB not supported, falling back to TEXT:", (e as Error).message);
      await this.client.execute(`
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT NOT NULL PRIMARY KEY,
          world_namespace TEXT NOT NULL,
          world_id TEXT NOT NULL,
          quad_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          text TEXT NOT NULL,
          vector TEXT NOT NULL,
          FOREIGN KEY (world_namespace, world_id) REFERENCES worlds (namespace, id) ON DELETE CASCADE
        )
      `);
    }

    // Create FTS5 virtual table for keyword search
    await this.client.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        content='chunks',
        content_rowid='id'
      )
    `);

    // Create triggers to keep FTS index in sync
    await this.client.execute(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
    await this.client.execute(`
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      END;
    `);
    await this.client.execute(`
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);

    // Create vector index for semantic search if supported
    if (this.vectorSupported) {
      try {
        await this.client.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunks_vector ON chunks (
            libsql_vector_idx(vector, 'metric=cosine')
          )
        `);
      } catch (e) {
        this.vectorSupported = false;
        console.warn(
          "Native vector index creation failed, falling back:",
          (e as Error).message,
        );
      }
    }
    this.initialized = true;
  }

  private rowToChunk(row: Record<string, unknown>): ChunkRecord {
    const vectorRaw = row["vector"];
    let vector: Float32Array;
    if (vectorRaw instanceof Uint8Array) {
      vector = new Float32Array(vectorRaw.buffer);
    } else {
      vector = deserializeVector(vectorRaw as string);
    }
    return {
      id: row["id"] as string,
      quadId: row["quad_id"] as string,
      subject: row["subject"] as string,
      predicate: row["predicate"] as string,
      text: row["text"] as string,
      vector,
      world: this.world,
    };
  }
}

// ── LibsqlChunkIndexManager ─────────────────────────────────────────────────

export class LibsqlChunkIndexManager implements ChunkIndexManager {
  private readonly indexes = new Map<string, LibsqlChunkIndex>();

  constructor(
    private readonly client: Client,
    private readonly dimensions: number,
  ) {}

  async getChunkIndex(world: WorldReference): Promise<ChunkIndex> {
    const key = formatWorldName(world);
    if (!this.indexes.has(key)) {
      this.indexes.set(
        key,
        new LibsqlChunkIndex(this.client, world, this.dimensions),
      );
    }
    return this.indexes.get(key)!;
  }

  async getIndexState(world: WorldReference): Promise<ChunkIndexState | null> {
    await this.ensureInitialized();
    const ns = world.namespace;
    const result = await this.client.execute({
      sql:
        `SELECT * FROM chunk_index_state WHERE world_namespace = ? AND world_id = ?`,
      args: [ns, world.id],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, unknown>;
    return {
      world,
      indexedAt: row["indexed_at"] as number,
      embeddingDimensions: row["embedding_dimensions"] as number,
      embeddingModel: row["embedding_model"] as string | undefined,
    };
  }

  async setIndexState(state: ChunkIndexState): Promise<void> {
    await this.ensureInitialized();
    const ns = state.world.namespace ?? "_";
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO chunk_index_state
            (world_namespace, world_id, indexed_at, embedding_dimensions, embedding_model)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        ns,
        state.world.id,
        state.indexedAt,
        state.embeddingDimensions,
        state.embeddingModel ?? null,
      ],
    });
    // Ensure an index exists so data-plane writers can rely on it.
    await this.getChunkIndex(state.world);
  }

  async deleteChunkIndex(reference: WorldReference): Promise<void> {
    const key = formatWorldName(reference);
    this.indexes.delete(key);
    const ns = reference.namespace ?? "_";
    await this.ensureInitialized();
    await this.client.execute({
      sql: `DELETE FROM chunks WHERE world_namespace = ? AND world_id = ?`,
      args: [ns, reference.id],
    });
    await this.client.execute({
      sql:
        `DELETE FROM chunk_index_state WHERE world_namespace = ? AND world_id = ?`,
      args: [ns, reference.id],
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.client.execute(`PRAGMA foreign_keys = ON;`);
      // Ensure the parent table exists for foreign keys
      await this.client.execute(`
        CREATE TABLE IF NOT EXISTS worlds (
          namespace TEXT NOT NULL,
          id TEXT NOT NULL,
          display_name TEXT,
          description TEXT,
          create_time INTEGER NOT NULL,
          PRIMARY KEY (namespace, id)
        )
      `);
      await this.client.execute(`
        CREATE TABLE IF NOT EXISTS chunk_index_state (
          world_namespace TEXT NOT NULL,
          world_id TEXT NOT NULL,
          indexed_at INTEGER NOT NULL,
          embedding_dimensions INTEGER NOT NULL,
          embedding_model TEXT,
          PRIMARY KEY (world_namespace, world_id)
        )
      `);
      this.initialized = true;
    } catch (e) {
      console.error("LibsqlChunkIndexManager.ensureInitialized FAILED:", e);
      throw e;
    }
  }

  private initialized = false;
}
