import { getByID, insert, remove, search } from "@orama/orama";
import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type {
  ChunkIndex,
  ChunkIndexManager,
  ChunkIndexSearchQuery,
} from "./interface.ts";
import { type ChunkOrama, createChunkOrama } from "./chunk-orama.ts";
import type { ChunkIndexState, ChunkRecord, ChunkSearchRow } from "./types.ts";

export class OramaChunkIndex implements ChunkIndex {
  constructor(
    private readonly world: WorldReference,
    private readonly getOrama: (
      dimensions: number,
    ) => Promise<ChunkOrama | null>,
  ) {}

  async setChunk(chunk: ChunkRecord): Promise<void> {
    if (
      formatWorldName(chunk.world) !== formatWorldName(this.world)
    ) {
      throw new Error("Chunk world does not match index world.");
    }
    const db = await this.getOrama(chunk.vector.length);
    if (!db) {
      throw new Error("Failed to initialize Orama DB for chunk index.");
    }
    const existing = await getByID(db, chunk.id);
    if (existing) await remove(db, chunk.id);
    await insert(db, {
      id: chunk.id,
      quadId: chunk.quadId,
      subject: chunk.subject,
      predicate: chunk.predicate,
      text: chunk.text,
      vector: Array.from(chunk.vector),
      vector_blob: Array.from(chunk.vector),
    });
  }

  async deleteChunk(quadId: string): Promise<void> {
    const db = await this.getOrama(0);
    if (!db) return;
    const results = await search(db, {
      term: "",
      where: { quadId },
    });
    for (const hit of results.hits) await remove(db, hit.id);
  }

  async getAll(): Promise<ChunkRecord[]> {
    const db = await this.getOrama(0);
    if (!db) return [];
    const results = await search(db, { term: "" });
    return results.hits.map((hit) => {
      const doc = hit.document;
      return {
        id: doc.id,
        quadId: doc.quadId,
        subject: doc.subject,
        predicate: doc.predicate,
        text: doc.text,
        vector: Float32Array.from(doc.vector_blob),
        world: this.world,
      };
    });
  }

  async search(input: ChunkIndexSearchQuery): Promise<ChunkSearchRow[]> {
    const db = await this.getOrama(0);
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

      // Defensive: Orama `where` should already handle these.
      if (input.subjects?.length && !input.subjects.includes(doc.subject)) {
        continue;
      }
      if (
        input.predicates?.length && !input.predicates.includes(doc.predicate)
      ) {
        continue;
      }

      rows.push({
        subject: doc.subject,
        predicate: doc.predicate,
        object: doc.text,
        vecRank: hit.score,
        ftsRank: hit.score,
        score: hit.score,
        world: this.world,
      });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows;
  }
}

export class OramaChunkIndexManager implements ChunkIndexManager {
  private readonly oramas = new Map<string, ChunkOrama>();
  private readonly indexes = new Map<string, OramaChunkIndex>();
  private readonly indexStateByWorld = new Map<string, ChunkIndexState>();

  async getChunkIndex(reference: WorldReference): Promise<ChunkIndex> {
    const key = formatWorldName(reference);
    let index = this.indexes.get(key);
    if (index) return index;

    index = new OramaChunkIndex(
      reference,
      (dimensions) => this.getOrCreateOrama(reference, dimensions),
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
    await this.getOrCreateOrama(state.world, state.embeddingDimensions);
    this.indexes.set(
      key,
      new OramaChunkIndex(
        state.world,
        (dimensions) => this.getOrCreateOrama(state.world, dimensions),
      ),
    );
  }

  async deleteChunkIndex(reference: WorldReference): Promise<void> {
    const key = formatWorldName(reference);
    this.oramas.delete(key);
    this.indexes.delete(key);
    this.indexStateByWorld.delete(key);
  }

  private async getOrCreateOrama(
    world: WorldReference,
    dimensions: number,
  ): Promise<ChunkOrama | null> {
    const key = formatWorldName(world);
    let orama = this.oramas.get(key);
    if (!orama) {
      if (!dimensions || dimensions <= 0) return null;
      orama = await createChunkOrama(dimensions);
      this.oramas.set(key, orama);
    }
    return orama;
  }
}
