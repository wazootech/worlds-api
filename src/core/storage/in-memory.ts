import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { formatWorldName } from "#/core/resolve.ts";
import type { StoredWorld, WorldStorage } from "./interface.ts";
import { WorldAlreadyExistsError } from "#/core/errors.ts";

export class InMemoryWorldStorage implements WorldStorage {
  private readonly worlds = new Map<string, StoredWorld>();

  async getWorld(reference: WorldReference): Promise<StoredWorld | null> {
    return this.worlds.get(formatWorldName(reference)) ?? null;
  }

  async createWorld(world: StoredWorld): Promise<void> {
    const key = formatWorldName(world.reference);
    if (this.worlds.has(key)) {
      throw new WorldAlreadyExistsError(world.reference);
    }
    this.worlds.set(key, world);
  }

  async updateWorld(world: StoredWorld): Promise<void> {
    this.worlds.set(formatWorldName(world.reference), world);
  }

  async deleteWorld(reference: WorldReference): Promise<void> {
    this.worlds.delete(formatWorldName(reference));
  }

  async listWorlds(namespace?: string): Promise<StoredWorld[]> {
    return Array.from(this.worlds.values())
      .filter((w) => !namespace || w.reference.namespace === namespace)
      .sort((a, b) =>
        a.reference.namespace.localeCompare(b.reference.namespace) ||
        a.reference.id.localeCompare(b.reference.id)
      );
  }
}
