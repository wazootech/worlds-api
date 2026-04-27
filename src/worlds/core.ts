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
import { formatWorldName, resolveWorldReference } from "./resolve.ts";
import type { WorldStorage } from "./store/worlds/interface.ts";
import type { StoredWorld } from "./store/worlds/types.ts";
import type { StoreStorage } from "./store/store/interface.ts";
import { deserialize, getFormat, serialize, storeFromQuads, quadsFromStore } from "./rdf/rdf.ts";
import type { StoredQuad } from "./store/quad/types.ts";
import { executeSparql } from "./sparql/sparql.ts";

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
    const reference = resolveWorldReference(input.source);
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
    const reference = resolveWorldReference(input.source);
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
    const reference = resolveWorldReference(input.source);
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
    const sources = input.sources;
    if (!sources || sources.length === 0) {
      throw new Error("sparql requires at least one source");
    }

    const references = sources.map((s) => resolveWorldReference(s));
    for (const ref of references) {
      const existing = await this.worldStorage.getWorld(ref);
      if (!existing) {
        throw new Error(`World not found: ${formatWorldName(ref)}`);
      }
    }

    // Aggregate quads from all source worlds into a single store
    let allQuads: StoredQuad[] = [];
    for (const ref of references) {
      const quadStorage = await this.storeStorage.getQuadStorage(ref);
      const quads = await quadStorage.query([]);
      allQuads = allQuads.concat(quads);
    }

    const store = storeFromQuads(allQuads);

    // Execute the query
    const result = await executeSparql(store, input.query, {
      baseIRI: input.defaultGraphUris?.[0],
    });

    // Handle SPARQL UPDATE (void result) - check for INSERT/DELETE
    if (result === null) {
      // UPDATE operations: apply changes back to source worlds
      // For multi-source, apply to the first source only for now
      const ref = references[0];
      const quadStorage = await this.storeStorage.getQuadStorage(ref);

      // Get the current quads and the new state
      const currentQuads = await quadStorage.query([]);
      const currentStore = storeFromQuads(currentQuads);
      const newStore = store; // store now reflects the updated state

      // Compute added/removed quads by comparing
      const newQuads = quadsFromStore(newStore);
      const currentQuadSet = new Set(currentQuads.map((q) => `${q.subject}|${q.predicate}|${q.object}|${q.graph}`));
      const newQuadSet = new Set(newQuads.map((q) => `${q.subject}|${q.predicate}|${q.object}|${q.graph}`));

      // Quads to remove (in current but not in new)
      const toRemove = currentQuads.filter((q) => !newQuadSet.has(`${q.subject}|${q.predicate}|${q.object}|${q.graph}`));
      // Quads to add (in new but not in current)
      const toAdd = newQuads.filter((q) => !currentQuadSet.has(`${q.subject}|${q.predicate}|${q.object}|${q.graph}`));

      if (toRemove.length > 0) {
        await quadStorage.remove(toRemove);
      }
      if (toAdd.length > 0) {
        await quadStorage.add(toAdd);
      }

      return null;
    }

    return result;
  }

  async search(_input: SearchRequest): Promise<SearchResponse> {
    throw new Error("search not implemented");
  }

  async import(input: ImportWorldRequest): Promise<void> {
    const reference = resolveWorldReference(input.source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }

    const contentType = input.contentType || "application/n-quads";
    const data = typeof input.data === "string"
      ? input.data
      : new TextDecoder().decode(input.data);
    const quads = deserialize(data, contentType);

    const quadStorage = await this.storeStorage.getQuadStorage(reference);
    await quadStorage.add(quads);
  }

  async export(input: ExportWorldRequest): Promise<ArrayBuffer> {
    const reference = resolveWorldReference(input.source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }

    const quadStorage = await this.storeStorage.getQuadStorage(reference);
    const quads = await quadStorage.query([]);

    const contentType = input.contentType || "application/n-quads";
    const serialized = await serialize(quads, contentType);
    return new TextEncoder().encode(serialized).buffer as ArrayBuffer;
  }
}
