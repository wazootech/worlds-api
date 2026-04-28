import {
  create,
  getByID,
  insert,
  type Orama,
  remove,
  search,
} from "@orama/orama";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { ChunkStorage } from "./interface.ts";
import type {
  ChunkIndexState,
  ChunkRecord,
  ChunkSearchQuery,
  ChunkSearchRow,
} from "./types.ts";

function worldKey(ref: WorldReference): string {
  return `${ref.namespace}/${ref.id}`;
}

function dotNormalized(
  a: Float32Array | number[],
  b: Float32Array | number[],
): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

const CHUNK_SCHEMA = {
  id: "string",
  factId: "string",
  subject: "string",
  predicate: "string",
  text: "string",
  namespace: "string",
  worldId: "string",
  vector: "string",
} as const;

interface OramaChunkDoc {
  id: string;
  factId: string;
  subject: string;
  predicate: string;
  text: string;
  namespace: string;
  worldId: string;
  vector: string;
}

export class OramaChunkStorage implements ChunkStorage {
  private db: Orama<typeof CHUNK_SCHEMA>;
  private readonly indexStateByWorld = new Map<string, ChunkIndexState>();

  private constructor(db: Orama<typeof CHUNK_SCHEMA>) {
    this.db = db;
  }

  static async create(): Promise<OramaChunkStorage> {
    const db = await create({
      schema: CHUNK_SCHEMA,
    });
    return new OramaChunkStorage(db);
  }

  private docFromChunk(chunk: ChunkRecord): OramaChunkDoc {
    return {
      id: chunk.id,
      factId: chunk.factId,
      subject: chunk.subject,
      predicate: chunk.predicate,
      text: chunk.text,
      namespace: chunk.world.namespace,
      worldId: chunk.world.id,
      vector: Array.from(chunk.vector).join(","),
    };
  }

  private chunkFromDoc(doc: OramaChunkDoc, vector: Float32Array): ChunkRecord {
    return {
      id: doc.id,
      factId: doc.factId,
      subject: doc.subject,
      predicate: doc.predicate,
      text: doc.text,
      vector,
      world: { namespace: doc.namespace, id: doc.worldId },
    };
  }

  async setChunk(chunk: ChunkRecord): Promise<void> {
    const existing = await getByID(this.db, chunk.id);
    if (existing) {
      await remove(this.db, chunk.id);
    }
    const doc = this.docFromChunk(chunk);
    await insert(this.db, doc);
  }

  async deleteChunk(world: WorldReference, factId: string): Promise<void> {
    const results = await search(this.db, {
      term: "",
      where: {
        factId: factId,
        namespace: world.namespace,
        worldId: world.id,
      },
    });
    for (const hit of results.hits) {
      await remove(this.db, hit.id);
    }
  }

  async getByWorld(world: WorldReference): Promise<ChunkRecord[]> {
    const results = await search(this.db, {
      term: "",
      where: {
        namespace: world.namespace,
        worldId: world.id,
      },
    });
    return results.hits.map((hit) => {
      const doc = hit.document as unknown as OramaChunkDoc;
      const vector = new Float32Array(
        doc.vector.split(",").map((n) => parseFloat(n)),
      );
      return this.chunkFromDoc(doc, vector);
    });
  }

  async search(input: ChunkSearchQuery): Promise<ChunkSearchRow[]> {
    const chunks = (
      await Promise.all(input.worlds.map((world) => this.getByWorld(world)))
    ).flat();

    const rows: ChunkSearchRow[] = [];
    const qFull = input.queryText.toLowerCase();

    for (const chunk of chunks) {
      const hay = `${chunk.subject} ${chunk.predicate} ${chunk.text}`
        .toLowerCase();
      const termsFound = input.queryTerms.filter((t) =>
        hay.includes(t.toLowerCase())
      ).length;
      const phraseMatch = qFull.length > 0 && hay.includes(qFull);

      if (termsFound === 0 && !phraseMatch) continue;

      const vecRank = dotNormalized(input.queryVector, chunk.vector);
      const ftsRank = termsFound > 0 ? termsFound : null;
      const score = (ftsRank ?? 0) * 1000 + (vecRank > 1e-12 ? vecRank : 0);

      rows.push({
        chunk,
        vecRank: vecRank > 1e-12 ? vecRank : null,
        ftsRank,
        score,
      });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  async getIndexState(world: WorldReference): Promise<ChunkIndexState | null> {
    return this.indexStateByWorld.get(worldKey(world)) ?? null;
  }

  async markWorldIndexed(state: ChunkIndexState): Promise<void> {
    this.indexStateByWorld.set(worldKey(state.world), state);
  }

  async clearWorld(world: WorldReference): Promise<void> {
    const chunks = await this.getByWorld(world);
    for (const chunk of chunks) {
      await remove(this.db, chunk.id);
    }
    this.indexStateByWorld.delete(worldKey(world));
  }
}
