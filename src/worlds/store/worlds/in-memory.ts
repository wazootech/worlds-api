import type { MetadataStorage, StoredWorld } from "./interface.ts";
import type { WorldReference } from "#/openapi/generated/types.gen.ts";

function keyOfRef(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

function keyOfWorld(world: StoredWorld): string {
  return keyOfRef(world.reference);
}

export class InMemoryMetadataStorage implements MetadataStorage {
  private readonly worlds = new Map<string, StoredWorld>();

  async get(reference: WorldReference): Promise<StoredWorld | null> {
    return this.worlds.get(keyOfRef(reference)) ?? null;
  }

  async put(world: StoredWorld): Promise<void> {
    this.worlds.set(keyOfWorld(world), world);
  }

  async delete(reference: WorldReference): Promise<void> {
    this.worlds.delete(keyOfRef(reference));
  }

  async list(namespace?: string): Promise<StoredWorld[]> {
    return Array.from(this.worlds.values())
      .filter((w) => !namespace || w.reference.namespace === namespace)
      .sort((a, b) => a.reference.id.localeCompare(b.reference.id));
  }
}