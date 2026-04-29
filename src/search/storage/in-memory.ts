import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { RDF_TYPE } from "#/facts/rdf/vocab.ts";
import { ftsTermHits } from "#/search/fts.ts";
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

function buildSubjectTypes(chunks: ChunkRecord[]): Map<string, Set<string>> {
  const subjectTypes = new Map<string, Set<string>>();
  for (const c of chunks) {
    if (c.predicate !== RDF_TYPE) continue;
    if (!subjectTypes.has(c.subject)) subjectTypes.set(c.subject, new Set());
    subjectTypes.get(c.subject)!.add(c.text);
  }
  return subjectTypes;
}

export class InMemoryChunkStorage implements ChunkStorage {
  private readonly chunksById = new Map<string, ChunkRecord>();
  private readonly chunkIdsByWorld = new Map<string, Set<string>>();
  private readonly chunkIdsByFact = new Map<string, Set<string>>();
  private readonly indexStateByWorld = new Map<string, ChunkIndexState>();

  private chunkIdsForWorld(world: WorldReference): Set<string> {
    const key = worldKey(world);
    let ids = this.chunkIdsByWorld.get(key);
    if (!ids) {
      ids = new Set();
      this.chunkIdsByWorld.set(key, ids);
    }
    return ids;
  }

  private factKey(world: WorldReference, factId: string): string {
    return `${worldKey(world)}|${factId}`;
  }

  async setChunk(chunk: ChunkRecord): Promise<void> {
    const previous = this.chunksById.get(chunk.id);
    if (previous) {
      this.chunkIdsByWorld.get(worldKey(previous.world))?.delete(previous.id);
      this.chunkIdsByFact.get(this.factKey(previous.world, previous.factId))
        ?.delete(previous.id);
    }

    this.chunksById.set(chunk.id, chunk);
    this.chunkIdsForWorld(chunk.world).add(chunk.id);

    const factKey = this.factKey(chunk.world, chunk.factId);
    let factIds = this.chunkIdsByFact.get(factKey);
    if (!factIds) {
      factIds = new Set();
      this.chunkIdsByFact.set(factKey, factIds);
    }
    factIds.add(chunk.id);
  }

  async deleteChunk(world: WorldReference, factId: string): Promise<void> {
    const factKey = this.factKey(world, factId);
    const ids = this.chunkIdsByFact.get(factKey);
    if (!ids) return;

    for (const id of ids) {
      this.chunksById.delete(id);
      this.chunkIdsByWorld.get(worldKey(world))?.delete(id);
    }
    this.chunkIdsByFact.delete(factKey);
  }

  async getByWorld(world: WorldReference): Promise<ChunkRecord[]> {
    const ids = this.chunkIdsByWorld.get(worldKey(world));
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.chunksById.get(id))
      .filter((chunk): chunk is ChunkRecord => chunk !== undefined);
  }

  async search(input: ChunkSearchQuery): Promise<ChunkSearchRow[]> {
    const chunks = (
      await Promise.all(input.worlds.map((world) => this.getByWorld(world)))
    ).flat();
    const subjectTypes = buildSubjectTypes(chunks);
    const qFull = input.queryText.toLowerCase();

    const rows: ChunkSearchRow[] = [];

    const filtered = chunks.filter((c) =>
      !input.subjects || input.subjects.length === 0 ||
      input.subjects.includes(c.subject)
    ).filter((c) =>
      !input.predicates || input.predicates.length === 0 ||
      input.predicates.includes(c.predicate)
    ).filter((c) => {
      if (!input.types || input.types.length === 0) return true;
      const st = subjectTypes.get(c.subject);
      return input.types.some((t) => st?.has(t));
    });

    for (const chunk of filtered) {
      const fts = ftsTermHits(
        input.queryTerms,
        chunk.subject,
        chunk.predicate,
        chunk.text,
      );
      const hay = `${chunk.subject} ${chunk.predicate} ${chunk.text}`
        .toLowerCase();
      const phraseMatch = qFull.length > 0 && hay.includes(qFull);

      if (fts === 0 && !phraseMatch) continue;

      const dot = dotNormalized(input.queryVector, chunk.vector);
      const vecRank = dot > 1e-12 ? dot : null;
      const score = fts * 1000 + (vecRank ?? 0);

      rows.push({
        chunk,
        vecRank,
        ftsRank: fts > 0 ? fts : null,
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
    const key = worldKey(world);
    const ids = this.chunkIdsByWorld.get(key);
    if (ids) {
      for (const id of ids) {
        const chunk = this.chunksById.get(id);
        if (chunk) {
          this.chunkIdsByFact.get(this.factKey(chunk.world, chunk.factId))
            ?.delete(id);
        }
        this.chunksById.delete(id);
      }
    }
    this.chunkIdsByWorld.delete(key);
    this.indexStateByWorld.delete(key);
  }
}
