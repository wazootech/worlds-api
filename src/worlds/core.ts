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
  SparqlRequest,
  SparqlResponse,
  UpdateWorldRequest,
  World,
  WorldReference,
} from "#/openapi/generated/types.gen.ts";
import type { WorldsInterface } from "./interfaces.ts";
import { formatWorldName, resolveWorldRefFromSource } from "./resolve.ts";
import type { WorldStorage } from "./store/worlds/interface.ts";
import type { StoredWorld } from "./store/worlds/types.ts";
import type { StoreStorage } from "./store/store/interface.ts";

function toWorld(stored: StoredWorld): World {
  return {
    name: formatWorldName(stored.reference),
    namespace: stored.reference.namespace,
    id: stored.reference.id,
    displayName: stored.displayName,
    description: stored.description,
    createTime: stored.createTime,
  };
}

/**
 * WorldsCore is the in-process reference implementation of WorldsInterface.
 * Accepts WorldStorage and StoreStorage for all persistence.
 */
export class WorldsCore implements WorldsInterface {
  constructor(
    private readonly worldStorage: WorldStorage,
    private readonly storeStorage: StoreStorage,
  ) {}

  async getWorld(input: GetWorldRequest): Promise<World | null> {
    const reference = resolveWorldRefFromSource(input.source);
    const stored = await this.worldStorage.getWorld(reference);
    return stored ? toWorld(stored) : null;
  }

  async createWorld(input: CreateWorldRequest): Promise<World> {
    const reference: WorldReference = {
      namespace: input.namespace,
      id: input.id,
    };
    const existing = await this.worldStorage.getWorld(reference);
    if (existing) {
      throw new Error(`World already exists: ${formatWorldName(reference)}`);
    }
    const stored: StoredWorld = {
      reference,
      displayName: input.displayName,
      description: input.description,
      createTime: Date.now(),
    };
    await this.worldStorage.updateWorld(stored);
    return toWorld(stored);
  }

  async updateWorld(input: UpdateWorldRequest): Promise<World> {
    const reference = resolveWorldRefFromSource(input.source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }
    const updated: StoredWorld = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      description: input.description ?? existing.description,
    };
    await this.worldStorage.updateWorld(updated);
    return toWorld(updated);
  }

  async deleteWorld(input: DeleteWorldRequest): Promise<void> {
    const reference = resolveWorldRefFromSource(input.source);
    await this.worldStorage.deleteWorld(reference);
    if ("deleteQuadStorage" in this.storeStorage) {
      await (this.storeStorage as {
        deleteQuadStorage(reference: WorldReference): Promise<void>;
      }).deleteQuadStorage(reference);
    }
  }

  async listWorlds(input?: ListWorldsRequest): Promise<ListWorldsResponse> {
    const namespaceFilter = input?.parent?.trim();
    const all = await this.worldStorage.listWorld(namespaceFilter);

    const pageSize = input?.pageSize && input.pageSize > 0
      ? input.pageSize
      : all.length;
    const worlds = all.slice(0, pageSize).map(toWorld);

    return { worlds };
  }

  async sparql(input: SparqlRequest): Promise<SparqlResponse> {
    const source = input.sources?.[0];
    if (!source) {
      throw new Error("sparql requires a source");
    }
    const reference = resolveWorldRefFromSource(source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }

    // TODO: wire up proper SPARQL engine (e.g., rdflib, sparqljs)
    return {
      head: { vars: [] },
      results: { bindings: [] },
    };
  }

  async search(_input: SearchRequest): Promise<SearchResponse> {
    throw new Error("search not implemented");
  }

  async import(input: ImportWorldRequest): Promise<void> {
    const reference = resolveWorldRefFromSource(input.source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }

    // TODO: use proper RDF parsing (n3 or similar)
    throw new Error("import: format provider not yet wired");
  }

  async export(_input: ExportWorldRequest): Promise<ArrayBuffer> {
    throw new Error("export: format provider not yet wired");
  }
}
