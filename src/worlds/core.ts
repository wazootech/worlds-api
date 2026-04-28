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
import type { ChunkStorage } from "#/infrastructure/chunks/interface.ts";
import type { EmbeddingsService } from "#/infrastructure/embeddings/interface.ts";
import { InMemoryChunkStorage } from "#/infrastructure/chunks/in-memory.ts";
import { PlaceholderEmbeddingsService } from "#/infrastructure/embeddings/placeholder.ts";
import { searchChunks } from "#/infrastructure/search/chunks-search-engine.ts";
import type { WorldsInterface } from "./interfaces.ts";
import { formatWorldName, resolveWorldReference } from "./resolve.ts";
import type { WorldStorage } from "./store/worlds/interface.ts";
import type { StoredWorld } from "./store/worlds/types.ts";
import type { StoreStorage } from "./store/store/interface.ts";
import {
  deserialize,
  quadsFromStore,
  serialize,
  storeFromQuads,
} from "./rdf/rdf.ts";
import { ftsTermHits, tokenizeSearchQuery } from "./search/fts.ts";
import { storedQuadKey } from "./store/quad/key.ts";
import type { StoredQuad } from "./store/quad/types.ts";
import { executeSparql } from "./sparql/sparql.ts";

/** Shared chunk index + embeddings for vector search (must match {@link IndexedStoreStorage} deps when used). */
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
    private readonly storeStorage: StoreStorage,
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
      const newStore = store; // store now reflects the updated state

      // Compute added/removed quads by comparing
      const newQuads = quadsFromStore(newStore);
      const currentQuadSet = new Set(
        currentQuads.map(storedQuadKey),
      );
      const newQuadSet = new Set(
        newQuads.map(storedQuadKey),
      );

      // Quads to remove (in current but not in new)
      const toRemove = currentQuads.filter((q) =>
        !newQuadSet.has(storedQuadKey(q))
      );
      // Quads to add (in new but not in current)
      const toAdd = newQuads.filter((q) =>
        !currentQuadSet.has(storedQuadKey(q))
      );

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
   * Full quad scan + term counts (legacy path when no chunk index exists).
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
      const quadStorage = await this.storeStorage.getQuadStorage(ref);
      const quads = await quadStorage.query([]);

      const meta = await this.worldStorage.getWorld(ref);
      const world: World = {
        name: formatWorldName(ref),
        namespace: ref.namespace,
        id: ref.id,
        displayName: meta?.displayName ?? "",
        description: meta?.description,
        createTime: meta?.createTime ?? 0,
      };

      for (const q of quads) {
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
