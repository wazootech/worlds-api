import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { ChunkStorage } from "./interface.ts";
import type { ChunkRecord } from "./types.ts";

function worldKey(ref: WorldReference): string {
  return `${ref.namespace}/${ref.id}`;
}

/**
 * In-memory chunk index keyed by world, then chunk id.
 */
export class InMemoryChunkStorage implements ChunkStorage {
  private readonly byWorld = new Map<string, Map<string, ChunkRecord>>();

  private mapFor(world: WorldReference): Map<string, ChunkRecord> {
    const key = worldKey(world);
    let m = this.byWorld.get(key);
    if (!m) {
      m = new Map();
      this.byWorld.set(key, m);
    }
    return m;
  }

  async upsert(chunk: ChunkRecord): Promise<void> {
    this.mapFor(chunk.world).set(chunk.id, chunk);
  }

  async deleteByFactId(world: WorldReference, factId: string): Promise<void> {
    const m = this.mapFor(world);
    for (const [id, row] of m.entries()) {
      if (row.factId === factId) m.delete(id);
    }
  }

  async getByWorld(world: WorldReference): Promise<ChunkRecord[]> {
    return Array.from(this.mapFor(world).values());
  }

  async clearWorld(world: WorldReference): Promise<void> {
    this.byWorld.delete(worldKey(world));
  }
}
