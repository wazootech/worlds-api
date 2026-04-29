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
  SearchResult,
  SparqlRequest,
  SparqlResponse,
  UpdateWorldRequest,
  World,
  WorldReference,
} from "#/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/worlds/embeddings/interface.ts";
import { PlaceholderEmbeddingsService } from "#/worlds/embeddings/placeholder.ts";
import { searchChunks } from "#/worlds/search/chunks-search-engine.ts";
import type { ChunkStorage } from "#/worlds/search/chunks/interface.ts";
import { InMemoryChunkStorage } from "#/worlds/search/chunks/in-memory.ts";
import type { WorldsInterface } from "./interfaces.ts";
import { formatWorldName, resolveWorldReference } from "./resolve.ts";
import type { WorldStorage } from "./core/worlds/interface.ts";
import type { StoredWorld } from "./core/worlds/types.ts";
import type { WorldFactStorage } from "./store/store/interface.ts";
import {
  deserialize,
  factsFromStore,
  serialize,
  storeFromFacts,
} from "./rdf/rdf.ts";
import { ftsTermHits, tokenizeSearchQuery } from "./search/fts.ts";
import { storedFactKey } from "./rdf/facts/key.ts";
import type { StoredFact } from "./rdf/facts/types.ts";
import { executeSparql } from "./sparql/sparql.ts";

/** Shared chunk index + embeddings for vector search (must match {@link IndexedWorldFactStorage} deps when used). */
export interface WorldsCoreSearchDeps {
  chunkStorage: ChunkStorage;
  embeddings: EmbeddingsService;
}

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
  private readonly searchDeps: WorldsCoreSearchDeps;

  constructor(
    private readonly worldStorage: WorldStorage,
    private readonly worldFactStorage: WorldFactStorage,
    searchDeps?: WorldsCoreSearchDeps,
  ) {
    this.searchDeps = searchDeps ?? {
      chunkStorage: new InMemoryChunkStorage(),
      embeddings: new PlaceholderEmbeddingsService(),
    };
  }

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
    if ("deleteFactStorage" in this.worldFactStorage) {
      await (this.worldFactStorage as {
        deleteFactStorage(reference: WorldReference): Promise<void>;
      }).deleteFactStorage(reference);
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

    // Aggregate facts from all source worlds into a single store
    let allFacts: StoredFact[] = [];
    for (const ref of references) {
      const factStorage = await this.worldFactStorage.getFactStorage(ref);
      const facts = await factStorage.findFacts([]);
      allFacts = allFacts.concat(facts);
    }

    const store = storeFromFacts(allFacts);

    // Execute the query
    const result = await executeSparql(store, input.query, {
      baseIRI: input.defaultGraphUris?.[0],
    });

    // Handle SPARQL UPDATE (void result) - check for INSERT/DELETE
    if (result === null) {
      const ref = references[0];
      const factStorage = await this.worldFactStorage.getFactStorage(ref);

      const currentFacts = await factStorage.findFacts([]);
      const newStore = store;

      const newFacts = factsFromStore(newStore);
      const currentFactSet = new Set(
        currentFacts.map(storedFactKey),
      );
      const newFactSet = new Set(
        newFacts.map(storedFactKey),
      );

      const toRemove = currentFacts.filter((q: StoredFact) =>
        !newFactSet.has(storedFactKey(q))
      );
      const toAdd = newFacts.filter((q: StoredFact) =>
        !currentFactSet.has(storedFactKey(q))
      );

      if (toRemove.length > 0) {
        await factStorage.deleteFacts(toRemove);
      }
      if (toAdd.length > 0) {
        await factStorage.setFacts(toAdd);
      }

      return null;
    }

    return result;
  }

  async search(input: SearchRequest): Promise<SearchResponse> {
    const sources = input.sources;
    const targetRefs: WorldReference[] = [];

    if (!sources || sources.length === 0) {
      const all = await this.worldStorage.listWorld(undefined);
      for (const w of all) {
        targetRefs.push(w.reference);
      }
    } else {
      for (const src of sources) {
        const ref = resolveWorldReference(src);
        const existing = await this.worldStorage.getWorld(ref);
        if (!existing) {
          throw new Error(`World not found: ${formatWorldName(ref)}`);
        }
        targetRefs.push(ref);
      }
    }

    const queryTerms = tokenizeSearchQuery(input.query);

    if (queryTerms.length === 0) {
      return { results: [] };
    }

    const indexedRefs: WorldReference[] = [];
    const unindexedRefs: WorldReference[] = [];
    for (const ref of targetRefs) {
      const indexState = await this.searchDeps.chunkStorage.getIndexState(ref);
      if (indexState) {
        indexedRefs.push(ref);
      } else {
        unindexedRefs.push(ref);
      }
    }

    const chunkResults = indexedRefs.length > 0
      ? await searchChunks(input, indexedRefs, {
        chunkStorage: this.searchDeps.chunkStorage,
        embeddings: this.searchDeps.embeddings,
        worldStorage: this.worldStorage,
        formatWorldName,
      })
      : [];
    const naiveResults = unindexedRefs.length > 0
      ? await this.searchNaiveFts(unindexedRefs, queryTerms)
      : [];
    const allResults = [...chunkResults, ...naiveResults].sort((a, b) =>
      b.ftsRank! - a.ftsRank! || b.score - a.score
    );

    const pageSize = input.pageSize ?? 20;
    const pageToken = input.pageToken ?? "";
    const startIndex = pageToken ? parseInt(pageToken, 10) : 0;
    const pagedResults = allResults.slice(startIndex, startIndex + pageSize);

    const nextPageToken = startIndex + pageSize < allResults.length
      ? String(startIndex + pageSize)
      : undefined;

    return { results: pagedResults, nextPageToken };
  }

  /**
   * Full fact scan + term counts (legacy path when no chunk index exists).
   */
  private async searchNaiveFts(
    targetRefs: WorldReference[],
    queryTerms: string[],
  ): Promise<SearchResult[]> {
    const allResults: Array<{
      subject: string;
      predicate: string;
      object: string;
      ftsRank: number;
      world: World;
    }> = [];

    for (const ref of targetRefs) {
      const factStorage = await this.worldFactStorage.getFactStorage(ref);
      const facts = await factStorage.findFacts([]);

      const meta = await this.worldStorage.getWorld(ref);
      const world: World = {
        name: formatWorldName(ref),
        namespace: ref.namespace,
        id: ref.id,
        displayName: meta?.displayName ?? "",
        description: meta?.description,
        createTime: meta?.createTime ?? 0,
      };

      for (const q of facts) {
        const score = ftsTermHits(
          queryTerms,
          q.subject,
          q.predicate,
          q.object,
        );

        if (score > 0) {
          allResults.push({
            subject: q.subject,
            predicate: q.predicate,
            object: q.object,
            ftsRank: score,
            world,
          });
        }
      }
    }

    allResults.sort((a, b) => b.ftsRank - a.ftsRank);

    return allResults.map((r) => ({
      subject: r.subject,
      predicate: r.predicate,
      object: r.object,
      vecRank: null,
      ftsRank: r.ftsRank,
      score: r.ftsRank,
      world: r.world,
    }));
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
    const facts = deserialize(data, contentType);

    const factStorage = await this.worldFactStorage.getFactStorage(reference);
    await factStorage.setFacts(facts);
  }

  async export(input: ExportWorldRequest): Promise<ArrayBuffer> {
    const reference = resolveWorldReference(input.source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }

    const factStorage = await this.worldFactStorage.getFactStorage(reference);
    const facts = await factStorage.findFacts([]);

    const contentType = input.contentType || "application/n-quads";
    const serialized = await serialize(facts, contentType);
    return new TextEncoder().encode(serialized).buffer as ArrayBuffer;
  }
}
