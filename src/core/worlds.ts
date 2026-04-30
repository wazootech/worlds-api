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
} from "#/api/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { searchChunks } from "#/indexing/chunks-search-engine.ts";
import type { ChunkIndexManager } from "#/indexing/storage/interface.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import type { WorldsInterface } from "#/core/interfaces.ts";
import { formatWorldName, resolveWorldReference } from "#/core/resolve.ts";
import {
  assertPageTokenSig,
  decodePageToken,
  encodePageToken,
  signPageTokenParams,
} from "#/core/pagination.ts";
import type { WorldStorage } from "#/core/storage/interface.ts";
import type { StoredWorld } from "#/core/storage/types.ts";
import type { QuadStorageManager } from "#/rdf/storage/quad-storage.ts";
import {
  deserialize,
  quadsFromStore,
  serialize,
  storeFromQuads,
} from "#/rdf/rdf/rdf.ts";
import { ftsTermHits, tokenizeSearchQuery } from "#/indexing/fts.ts";
import { storedQuadKey } from "#/rdf/storage/quad-key.ts";
import type { StoredQuad } from "#/rdf/storage/quad.ts";
import { executeSparql } from "#/rdf/sparql/sparql.ts";

/** Shared chunk index + embeddings for vector search (must match {@link IndexedQuadStorageManager} deps when used). */
export interface WorldsSearchDeps {
  chunkIndexManager: ChunkIndexManager;
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
 * Worlds is the in-process reference implementation of WorldsInterface.
 * Accepts WorldStorage and QuadStorageManager for all persistence.
 */
export class Worlds implements WorldsInterface {
  private readonly searchDeps: WorldsSearchDeps;
  private static readonly DEFAULT_LIST_PAGE_SIZE = 50;
  private static readonly DEFAULT_SEARCH_PAGE_SIZE = 20;
  private static readonly MAX_PAGE_SIZE = 100;

  constructor(
    private readonly worldStorage: WorldStorage,
    private readonly quadStorageManager: QuadStorageManager,
    searchDeps?: WorldsSearchDeps,
  ) {
    this.searchDeps = searchDeps ?? {
      chunkIndexManager: new InMemoryChunkIndexManager(),
      embeddings: new FakeEmbeddingsService(),
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
    await this.quadStorageManager.deleteQuadStorage(reference);
  }

  async listWorlds(input?: ListWorldsRequest): Promise<ListWorldsResponse> {
    const namespaceFilter = input?.parent?.trim();
    const all = await this.worldStorage.listWorlds(namespaceFilter);

    const requestedPageSize = input?.pageSize;
    if (requestedPageSize !== undefined && requestedPageSize < 0) {
      throw new Error("Invalid page size");
    }
    const pageSizeRaw =
      requestedPageSize === undefined || requestedPageSize === 0
        ? Worlds.DEFAULT_LIST_PAGE_SIZE
        : requestedPageSize;
    const pageSize = Math.min(pageSizeRaw, Worlds.MAX_PAGE_SIZE);

    const sig = await signPageTokenParams({
      method: "listWorlds",
      parent: namespaceFilter ?? "",
    });

    const decoded = input?.pageToken?.trim()
      ? decodePageToken(input.pageToken.trim())
      : null;
    if (decoded) assertPageTokenSig(decoded, sig);
    const startIndex = decoded?.o ?? 0;

    const worlds = all.slice(startIndex, startIndex + pageSize).map(toWorld);
    const nextOffset = startIndex + pageSize;
    const nextPageToken = nextOffset < all.length
      ? encodePageToken({ v: 1, o: nextOffset, sig })
      : undefined;

    return { worlds, nextPageToken };
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
      const quadStorage = await this.quadStorageManager.getQuadStorage(ref);
      const quads = await quadStorage.findQuads([]);
      allQuads = allQuads.concat(quads);
    }

    const store = storeFromQuads(allQuads);

    // Execute the query
    const result = await executeSparql(store, input.query, {
      baseIRI: input.defaultGraphUris?.[0],
    });

    // Handle SPARQL UPDATE (void result) - check for INSERT/DELETE
    if (result === null) {
      const ref = references[0];
      const quadStorage = await this.quadStorageManager.getQuadStorage(ref);

      const currentQuads = await quadStorage.findQuads([]);
      const newStore = store;

      const newQuads = quadsFromStore(newStore);
      const currentQuadSet = new Set(
        currentQuads.map(storedQuadKey),
      );
      const newQuadSet = new Set(
        newQuads.map(storedQuadKey),
      );

      const toRemove = currentQuads.filter((q: StoredQuad) =>
        !newQuadSet.has(storedQuadKey(q))
      );
      const toAdd = newQuads.filter((q: StoredQuad) =>
        !currentQuadSet.has(storedQuadKey(q))
      );

      if (toRemove.length > 0) {
        await quadStorage.deleteQuads(toRemove);
      }
      if (toAdd.length > 0) {
        await quadStorage.setQuads(toAdd);
      }

      return null;
    }

    return result;
  }

  async search(input: SearchRequest): Promise<SearchResponse> {
    const sources = input.sources;
    const targetRefs: WorldReference[] = [];

    if (!sources || sources.length === 0) {
      const all = await this.worldStorage.listWorlds(undefined);
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
      const indexState = await this.searchDeps.chunkIndexManager.getIndexState(
        ref,
      );
      if (indexState) {
        indexedRefs.push(ref);
      } else {
        unindexedRefs.push(ref);
      }
    }

    const chunkResults = indexedRefs.length > 0
      ? await searchChunks(input, indexedRefs, {
        chunkIndexManager: this.searchDeps.chunkIndexManager,
        embeddings: this.searchDeps.embeddings,
        worldStorage: this.worldStorage,
        formatWorldName,
      })
      : [];
    const naiveResults = unindexedRefs.length > 0
      ? await this.searchNaiveFts(unindexedRefs, queryTerms)
      : [];
    const allResults = [...chunkResults, ...naiveResults].sort((a, b) =>
      (b.ftsRank! - a.ftsRank!) ||
      (b.score - a.score) ||
      // Stable deterministic tie-breakers so offset pagination is consistent.
      ((a.world.name ?? "").localeCompare(b.world.name ?? "")) ||
      ((a.subject ?? "").localeCompare(b.subject ?? "")) ||
      ((a.predicate ?? "").localeCompare(b.predicate ?? "")) ||
      ((a.object ?? "").localeCompare(b.object ?? ""))
    );

    const requestedPageSize = input.pageSize;
    if (requestedPageSize !== undefined && requestedPageSize < 0) {
      throw new Error("Invalid page size");
    }
    const pageSizeRaw =
      requestedPageSize === undefined || requestedPageSize === 0
        ? Worlds.DEFAULT_SEARCH_PAGE_SIZE
        : requestedPageSize;
    const pageSize = Math.min(pageSizeRaw, Worlds.MAX_PAGE_SIZE);

    const normalizeStringArray = (arr?: string[]) =>
      (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0).sort();

    const sourcesSig = !sources || sources.length === 0
      ? { mode: "all" as const }
      : {
        mode: "explicit" as const,
        worlds: targetRefs.map(formatWorldName).sort(),
      };

    const sig = await signPageTokenParams({
      method: "searchWorlds",
      query: input.query,
      sources: sourcesSig,
      subjects: normalizeStringArray(input.subjects),
      predicates: normalizeStringArray(input.predicates),
      types: normalizeStringArray(input.types),
    });

    const decoded = input.pageToken?.trim()
      ? decodePageToken(input.pageToken.trim())
      : null;
    if (decoded) assertPageTokenSig(decoded, sig);
    const startIndex = decoded?.o ?? 0;

    const results = allResults.slice(startIndex, startIndex + pageSize);
    const nextOffset = startIndex + pageSize;
    const nextPageToken = nextOffset < allResults.length
      ? encodePageToken({ v: 1, o: nextOffset, sig })
      : undefined;

    return { results, nextPageToken };
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
      const quadStorage = await this.quadStorageManager.getQuadStorage(ref);
      const quads = await quadStorage.findQuads([]);

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

    const quadStorage = await this.quadStorageManager.getQuadStorage(reference);
    await quadStorage.setQuads(quads);
  }

  async export(input: ExportWorldRequest): Promise<ArrayBuffer> {
    const reference = resolveWorldReference(input.source);
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new Error(`World not found: ${formatWorldName(reference)}`);
    }

    const quadStorage = await this.quadStorageManager.getQuadStorage(reference);
    const quads = await quadStorage.findQuads([]);

    const contentType = input.contentType || "application/n-quads";
    const serialized = await serialize(quads, contentType);
    return new TextEncoder().encode(serialized).buffer as ArrayBuffer;
  }
}
