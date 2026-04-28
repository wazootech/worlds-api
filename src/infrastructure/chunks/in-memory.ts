import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { ChunkStorage } from "./interface.ts";
import type { ChunkIndexState, ChunkRecord } from "./types.ts";

function worldKey(ref: WorldReference): string {
  return `${ref.namespace}/${ref.id}`;
}

/**
 * In-memory chunk storage shaped like a small relational schema:
 * chunk rows by id, world membership, fact membership, and per-world index state.
 */
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

  async upsert(chunk: ChunkRecord): Promise<void> {
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

  async deleteByFactId(world: WorldReference, factId: string): Promise<void> {
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
