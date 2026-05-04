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
import {
  buildSubjectTypes,
  filterChunks,
  scoreChunk,
} from "./search-utils.ts";

function serializeVector(v: Float32Array | number[]): string {
  return JSON.stringify(Array.from(v));
}

function deserializeVector(json: string): Float32Array {
  return new Float32Array(JSON.parse(json));
}

// ── LibsqlChunkIndex ───────────────────────────────────────────────────────

export class LibsqlChunkIndex implements ChunkIndex {
  constructor(
    private readonly client: Client,
    private readonly world: WorldReference,
  ) {}

  async setChunk(chunk: ChunkRecord): Promise<void> {
    await this.ensureInitialized();
    const ns = chunk.world.namespace ?? "_";
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO chunks
            (id, world_namespace, world_id, quad_id, subject, predicate, text, vector)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    await this.ensureInitialized();
    const ns = this.world.namespace ?? "_";
    const result = await this.client.execute({
      sql: `SELECT * FROM chunks WHERE world_namespace = ? AND world_id = ?`,
      args: [ns, this.world.id],
    });
    return result.rows.map((row) => this.rowToChunk(row));
  }

  async search(input: ChunkIndexSearchQuery): Promise<ChunkSearchRow[]> {
    const chunks = await this.getAll();
    const subjectTypes = buildSubjectTypes(chunks);
    const filtered = filterChunks({
      chunks,
      subjects: input.subjects,
      predicates: input.predicates,
      types: input.types,
      subjectTypes,
    });

    const rows: ChunkSearchRow[] = [];
    for (const chunk of filtered) {
      const result = scoreChunk({
        chunk,
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

  private async ensureInitialized(): Promise<void> {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT NOT NULL PRIMARY KEY,
        world_namespace TEXT NOT NULL,
        world_id TEXT NOT NULL,
        quad_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        text TEXT NOT NULL,
        vector TEXT NOT NULL
      )
    `);
  }

  private rowToChunk(row: Record<string, unknown>): ChunkRecord {
    return {
      id: row["id"] as string,
      quadId: row["quad_id"] as string,
      subject: row["subject"] as string,
      predicate: row["predicate"] as string,
      text: row["text"] as string,
      vector: deserializeVector(row["vector"] as string),
      world: this.world,
    };
  }
}

// ── LibsqlChunkIndexManager ─────────────────────────────────────────────────

export class LibsqlChunkIndexManager implements ChunkIndexManager {
  private readonly indexes = new Map<string, LibsqlChunkIndex>();

  constructor(private readonly client: Client) {}

  async getChunkIndex(reference: WorldReference): Promise<ChunkIndex> {
    const key = formatWorldName(reference);
    let index = this.indexes.get(key);
    if (!index) {
      index = new LibsqlChunkIndex(this.client, reference);
      this.indexes.set(key, index);
    }
    return index;
  }

  async getIndexState(world: WorldReference): Promise<ChunkIndexState | null> {
    await this.ensureInitialized();
    const ns = world.namespace ?? "_";
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
  }
}
