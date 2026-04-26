import type {
  CreateWorldRequest,
  DeleteWorldRequest,
  ExportWorldRequest,
  GetWorldRequest,
  ImportWorldRequest,
  ListWorldsRequest,
  ListWorldsResponse,
  SearchRequest,
  SearchResponse,
  SparqlQueryRequest,
  SparqlQueryResponse,
  UpdateWorldRequest,
  World,
  WorldReference,
} from "#/openapi/generated/types.gen.ts";
import type { WorldsInterface } from "./interfaces.ts";
import { formatWorldName, resolveWorldRefFromSource } from "./resolve.ts";

type StoredWorld = {
  ref: WorldReference;
  displayName?: string;
  description?: string;
  createTime: number;
};

function keyOf(ref: WorldReference): string {
  return `${ref.namespace}/${ref.id}`;
}

function toWorld(stored: StoredWorld): World {
  return {
    name: formatWorldName(stored.ref),
    namespace: stored.ref.namespace,
    id: stored.ref.id,
    displayName: stored.displayName,
    description: stored.description,
    createTime: stored.createTime,
  };
}

/**
 * WorldsCore is the in-process reference implementation of WorldsInterface.
 *
 * It starts with management-plane semantics and will grow into the data-plane.
 */
export class WorldsCore implements WorldsInterface {
  private readonly worlds = new Map<string, StoredWorld>();

  async getWorld(input: GetWorldRequest): Promise<World | null> {
    const ref = resolveWorldRefFromSource(input.source);
    const stored = this.worlds.get(keyOf(ref)) ?? null;
    return stored ? toWorld(stored) : null;
  }

  async createWorld(input: CreateWorldRequest): Promise<World> {
    const ref: WorldReference = { namespace: input.namespace, id: input.id };
    const key = keyOf(ref);
    if (this.worlds.has(key)) {
      throw new Error(`World already exists: ${formatWorldName(ref)}`);
    }
    const now = Date.now();
    const stored: StoredWorld = {
      ref,
      displayName: input.displayName,
      description: input.description,
      createTime: now,
    };
    this.worlds.set(key, stored);
    return toWorld(stored);
  }

  async updateWorld(input: UpdateWorldRequest): Promise<World> {
    const ref = resolveWorldRefFromSource(input.source);
    const key = keyOf(ref);
    const existing = this.worlds.get(key);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(ref)}`);
    }
    const updated: StoredWorld = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      description: input.description ?? existing.description,
    };
    this.worlds.set(key, updated);
    return toWorld(updated);
  }

  async deleteWorld(input: DeleteWorldRequest): Promise<void> {
    const ref = resolveWorldRefFromSource(input.source);
    this.worlds.delete(keyOf(ref));
  }

  async listWorlds(input?: ListWorldsRequest): Promise<ListWorldsResponse> {
    // NOTE: ListWorldsRequest currently uses `parent`. For now, treat it as an
    // optional namespace filter to keep behavior deterministic.
    const namespaceFilter = input?.parent?.trim();

    const all = Array.from(this.worlds.values())
      .filter((w) => !namespaceFilter || w.ref.namespace === namespaceFilter)
      .sort((a, b) => a.ref.id.localeCompare(b.ref.id));

    // Minimal pagination: ignore tokens for now, respect pageSize.
    const pageSize = input?.pageSize && input.pageSize > 0
      ? input.pageSize
      : all.length;
    const worlds = all.slice(0, pageSize).map(toWorld);

    return { worlds };
  }

  async sparql(_input: SparqlQueryRequest): Promise<SparqlQueryResponse> {
    throw new Error("sparql not implemented");
  }

  async search(_input: SearchRequest): Promise<SearchResponse> {
    throw new Error("search not implemented");
  }

  async import(_input: ImportWorldRequest): Promise<void> {
    throw new Error("import not implemented");
  }

  async export(_input: ExportWorldRequest): Promise<ArrayBuffer> {
    throw new Error("export not implemented");
  }
}
