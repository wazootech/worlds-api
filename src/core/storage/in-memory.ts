import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { StoredWorld, WorldStorage } from "./interface.ts";

function keyOfRef(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

function keyOfWorld(world: StoredWorld): string {
  return keyOfRef(world.reference);
}

export class InMemoryWorldStorage implements WorldStorage {
  private readonly worlds = new Map<string, StoredWorld>();

  async getWorld(reference: WorldReference): Promise<StoredWorld | null> {
    return this.worlds.get(keyOfRef(reference)) ?? null;
  }

  async updateWorld(world: StoredWorld): Promise<void> {
    this.worlds.set(keyOfWorld(world), world);
  }

  async deleteWorld(reference: WorldReference): Promise<void> {
    this.worlds.delete(keyOfRef(reference));
  }

  async listWorld(namespace?: string): Promise<StoredWorld[]> {
    return Array.from(this.worlds.values())
      .filter((w) => !namespace || w.reference.namespace === namespace)
      .sort((a, b) => a.reference.id.localeCompare(b.reference.id));
  }
}
