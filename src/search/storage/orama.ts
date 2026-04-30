import { getByID, insert, remove, search } from "@orama/orama";
import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
} from "./interface.ts";
import {
  createChunkOramaDb,
  type ChunkOramaDb,
} from "./orama-chunk-db.ts";
import type { ChunkIndexState, ChunkRecord, ChunkSearchRow } from "./types.ts";

export class OramaChunkIndex implements ChunkIndex {
  constructor(
    private readonly world: WorldReference,
    private readonly getOrCreateDb: (
      dimensions: number,
    ) => Promise<ChunkOramaDb | null>,
  ) {}

  async setChunk(chunk: ChunkRecord): Promise<void> {
    if (
      formatWorldName(chunk.world) !== formatWorldName(this.world)
    ) {
      throw new Error("Chunk world does not match index world.");
    }
    const db = await this.getOrCreateDb(chunk.vector.length);
    if (!db) {
      throw new Error("Failed to initialize Orama DB for chunk index.");
    }
    const existing = await getByID(db, chunk.id);
    if (existing) await remove(db, chunk.id);
    await insert(db, {
      id: chunk.id,
      factId: chunk.factId,
      subject: chunk.subject,
      predicate: chunk.predicate,
      text: chunk.text,
      vector: Array.from(chunk.vector),
      vector_blob: Array.from(chunk.vector),
    });
  }

  async deleteChunk(factId: string): Promise<void> {
    const db = await this.getOrCreateDb(0);
    if (!db) return;
    const results = await search(db, {
      term: "",
      where: { factId },
    });
    for (const hit of results.hits) await remove(db, hit.id);
  }

  async getAll(): Promise<ChunkRecord[]> {
    const db = await this.getOrCreateDb(0);
    if (!db) return [];
    const results = await search(db, { term: "" });
    return results.hits.map((hit) => {
      const doc = hit.document;
      return {
        id: doc.id,
        factId: doc.factId,
        subject: doc.subject,
        predicate: doc.predicate,
        text: doc.text,
        vector: Float32Array.from(doc.vector_blob),
        world: this.world,
      };
    });
  }

  async search(input: ChunkIndexSearchQuery): Promise<ChunkSearchRow[]> {
    const db = await this.getOrCreateDb(0);
    if (!db) return [];
    const results = await search(db, {
      term: input.queryText,
      vector: {
        value: Array.from(input.queryVector),
        property: "vector",
      },
      where: {
        ...(input.subjects?.length ? { subject: input.subjects } : {}),
        ...(input.predicates?.length ? { predicate: input.predicates } : {}),
      },
    });

    const rows: ChunkSearchRow[] = [];
    for (const hit of results.hits) {
      const doc = hit.document;
      const chunk: ChunkRecord = {
        id: doc.id,
        factId: doc.factId,
        subject: doc.subject,
        predicate: doc.predicate,
        text: doc.text,
        vector: Float32Array.from(doc.vector_blob),
        world: this.world,
      };

      // Defensive: Orama `where` should already handle these.
      if (input.subjects?.length && !input.subjects.includes(chunk.subject)) {
        continue;
      }
      if (
        input.predicates?.length && !input.predicates.includes(chunk.predicate)
      ) {
        continue;
      }

      rows.push({
        chunk,
        vecRank: hit.score,
        ftsRank: hit.score,
        score: hit.score,
      });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows;
  }
}

export class OramaChunkIndexManager implements ChunkIndexManager {
  private readonly dbs = new Map<string, ChunkOramaDb>();
  private readonly indexes = new Map<string, OramaChunkIndex>();
  private readonly indexStateByWorld = new Map<string, ChunkIndexState>();

  async getChunkIndex(reference: WorldReference): Promise<ChunkIndex> {
    const key = formatWorldName(reference);
    let index = this.indexes.get(key);
    if (index) return index;

    index = new OramaChunkIndex(
      reference,
      (dimensions) => this.getOrCreateDb(reference, dimensions),
    );
    this.indexes.set(key, index);
    return index;
  }

  async getIndexState(world: WorldReference): Promise<ChunkIndexState | null> {
    return this.indexStateByWorld.get(formatWorldName(world)) ?? null;
  }

  async setIndexState(state: ChunkIndexState): Promise<void> {
    const key = formatWorldName(state.world);
    this.indexStateByWorld.set(key, state);
    await this.getOrCreateDb(state.world, state.embeddingDimensions);
    this.indexes.set(
      key,
      new OramaChunkIndex(
        state.world,
        (dimensions) => this.getOrCreateDb(state.world, dimensions),
      ),
    );
  }

  async deleteChunkIndex(reference: WorldReference): Promise<void> {
    const key = formatWorldName(reference);
    this.dbs.delete(key);
    this.indexes.delete(key);
    this.indexStateByWorld.delete(key);
  }

  private async getOrCreateDb(
    world: WorldReference,
    dimensions: number,
  ): Promise<ChunkOramaDb | null> {
    const key = formatWorldName(world);
    let db = this.dbs.get(key);
    if (!db) {
      if (!dimensions || dimensions <= 0) return null;
      db = await createChunkOramaDb(dimensions);
      this.dbs.set(key, db);
    }
    return db;
  }
}
