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
} from "#/rpc/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { OpenAIEmbeddingsService } from "#/indexing/embeddings/openai.ts";
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
import type { QuadStorageManager } from "#/rdf/storage/interface.ts";
import {
  deserialize,
  quadsFromStore,
  serialize,
  storeFromQuads,
} from "#/rdf/rdf.ts";
import { tokenizeSearchQuery } from "#/indexing/fts.ts";
import { storedQuadKey } from "#/rdf/storage/quad-key.ts";
import type { StoredQuad } from "#/rdf/storage/types.ts";
import { executeSparql } from "#/rdf/sparql/sparql.ts";
import { searchNaiveFts } from "./search-naive-fts.ts";
import {
  InvalidArgumentError,
  PermissionDeniedError,
  UnauthenticatedError,
  WorldNotFoundError,
} from "#/core/errors.ts";

/** Dependency injection for {@link Worlds}. Replaces separate constructor params. */
export interface WorldsOptions {
  worldStorage: WorldStorage;
  quadStorageManager: QuadStorageManager;
  chunkIndexManager?: ChunkIndexManager;
  embeddings?: EmbeddingsService;
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

const DEFAULT_LIST_PAGE_SIZE = 50;
const DEFAULT_SEARCH_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Reference {@link WorldsInterface} implementation with auth enforcement.
 */
export class Worlds implements WorldsInterface {
  private readonly worldStorage: WorldStorage;
  private readonly quadStorageManager: QuadStorageManager;
  private readonly searchDeps: {
    chunkIndexManager: ChunkIndexManager;
    embeddings: EmbeddingsService;
  };
  private readonly keyId: string | null;
  private readonly scopes: string[];
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    options: WorldsOptions,
    keyId: string | null = null,
    scopes: string[] = [],
  ) {
    this.worldStorage = options.worldStorage;
    this.quadStorageManager = options.quadStorageManager;
    this.keyId = keyId;
    this.scopes = scopes;
    this.searchDeps = options.chunkIndexManager && options.embeddings
      ? {
        chunkIndexManager: options.chunkIndexManager,
        embeddings: options.embeddings,
      }
      : {
        chunkIndexManager: new InMemoryChunkIndexManager(),
        embeddings: new FakeEmbeddingsService(),
      };
  }

  private assertAuthenticated(): void {
    if (!this.keyId) {
      throw new UnauthenticatedError();
    }
  }

  /**
   * Check if the API key has access to a specific world.
   * Matches scopes like: "world:read:ns/id", "world:write:ns/id", "world:*:ns/id",
   *                   "namespace:read:ns", "namespace:write:ns", "namespace:*:ns",
   *                   "world:*:*", "namespace:*:*", "*:*:*"
   */
  private hasWorldAccess(
    ref: WorldReference,
    verb: "read" | "write",
  ): boolean {
    const worldTarget = `${ref.namespace}/${ref.id}`;
    const nsTarget = ref.namespace;

    return this.scopes.some((scope) => {
      const parts = scope.split(":");
      if (parts.length !== 3) return false;
      const [resource, scopeVerb, target] = parts;

      // Check verb match
      const verbMatch = scopeVerb === "*" || scopeVerb === verb;

      // Check target match
      if (resource === "world") {
        const targetMatch = target === "*" || target === worldTarget;
        return verbMatch && targetMatch;
      }
      if (resource === "namespace") {
        const targetMatch = target === "*" || target === nsTarget;
        return verbMatch && targetMatch;
      }
      if (resource === "*") {
        return verbMatch && (target === "*" || target === worldTarget ||
          target === nsTarget);
      }
      return false;
    });
  }

  /**
   * Check if the API key has access to a namespace.
   */
  private hasNamespaceAccess(
    namespace: string,
    verb: "read" | "write",
  ): boolean {
    return this.scopes.some((scope) => {
      const parts = scope.split(":");
      if (parts.length !== 3) return false;
      const [resource, scopeVerb, target] = parts;

      const verbMatch = scopeVerb === "*" || scopeVerb === verb;

      if (resource === "namespace") {
        return verbMatch && (target === "*" || target === namespace);
      }
      if (resource === "world") {
        return verbMatch && (target === "*" ||
          target?.split("/")[0] === namespace);
      }
      if (resource === "*") {
        return verbMatch && (target === "*" || target === namespace);
      }
      return false;
    });
  }

  private async assertOwnsWorld(
    reference: WorldReference,
    verb: "read" | "write" = "write",
  ): Promise<void> {
    this.assertAuthenticated();
    const stored = await this.worldStorage.getWorld(reference);
    if (!stored) {
      throw new WorldNotFoundError(reference);
    }
    if (!this.hasWorldAccess(reference, verb)) {
      throw new PermissionDeniedError(`${reference.namespace}/${reference.id}`);
    }
  }

  private async assertOwnsNamespace(namespace: string): Promise<void> {
    this.assertAuthenticated();
    if (!this.hasNamespaceAccess(namespace, "write")) {
      throw new PermissionDeniedError(`namespace/${namespace}`);
    }
  }

  async getWorld(input: GetWorldRequest): Promise<World | null> {
    this.assertAuthenticated();
    const reference = resolveWorldReference(input.source);
    const stored = await this.worldStorage.getWorld(reference);
    if (!stored) {
      return null;
    }
    if (!this.hasWorldAccess(reference, "read")) {
      throw new PermissionDeniedError(
        `${reference.namespace}/${reference.id}`,
      );
    }
    return toWorld(stored);
  }

  private async withLock<T>(
    reference: WorldReference,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = formatWorldName(reference);
    const existing = this.locks.get(key) || Promise.resolve();

    let resolve: () => void;
    const next = new Promise<void>((res) => {
      resolve = res;
    });
    this.locks.set(key, next);

    try {
      await existing;
      return await fn();
    } finally {
      resolve!();
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  async createWorld(input: CreateWorldRequest): Promise<World> {
    this.assertAuthenticated();
    const reference: WorldReference = {
      namespace: input.namespace,
      id: input.id,
    };
    await this.assertOwnsNamespace(input.namespace);
    const stored: StoredWorld = {
      reference,
      displayName: input.displayName,
      description: input.description,
      createTime: Date.now(),
    };
    await this.worldStorage.createWorld(stored);
    return toWorld(stored);
  }

  async updateWorld(input: UpdateWorldRequest): Promise<World> {
    const reference = resolveWorldReference(input.source);
    await this.assertOwnsWorld(reference, "write");
    const existing = await this.worldStorage.getWorld(reference);
    if (!existing) {
      throw new WorldNotFoundError(reference);
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
    await this.assertOwnsWorld(reference, "write");
    await this.worldStorage.deleteWorld(reference);
    await this.quadStorageManager.deleteQuadStorage(reference);
  }

  async listWorlds(input?: ListWorldsRequest): Promise<ListWorldsResponse> {
    this.assertAuthenticated();
    const namespaceFilter = input?.parent?.trim();
    const all = await this.worldStorage.listWorlds(namespaceFilter);
    // Filter to only worlds the API key has read access to
    const accessible = all.filter((w) =>
      this.hasWorldAccess(w.reference, "read")
    );
    const pageSizeRaw = input?.pageSize === undefined || input.pageSize === 0
      ? DEFAULT_LIST_PAGE_SIZE
      : input.pageSize < 0
      ? (() => {
        throw new InvalidArgumentError("Invalid page size");
      })()
      : input.pageSize;
    const pageSize = Math.min(pageSizeRaw, MAX_PAGE_SIZE);
    const sig = await signPageTokenParams({
      method: "listWorlds",
      parent: namespaceFilter ?? "",
    });
    const decoded = input?.pageToken?.trim()
      ? decodePageToken(input.pageToken.trim())
      : null;
    if (decoded) assertPageTokenSig(decoded, sig);
    const startIndex = decoded?.o ?? 0;
    const worlds = accessible.slice(startIndex, startIndex + pageSize).map(
      toWorld,
    );
    const nextPageToken = startIndex + pageSize < accessible.length
      ? encodePageToken({ v: 1, o: startIndex + pageSize, sig })
      : undefined;
    return { worlds, nextPageToken };
  }

  async sparql(input: SparqlRequest): Promise<SparqlResponse> {
    this.assertAuthenticated();
    if (!input.source) {
      throw new InvalidArgumentError("sparql requires a source");
    }
    const ref = resolveWorldReference(input.source);
    await this.assertOwnsWorld(ref, "read"); // Will upgrade to write if it's an update

    const quadStorage = await this.quadStorageManager.getQuadStorage(ref);
    const quads = await quadStorage.findQuads([]);
    const store = storeFromQuads(quads);
    const result = await executeSparql(store, input.query, {
      baseIRI: input.defaultGraphUris?.[0],
    });
    if (result === null) {
      // UPDATE for single world
      const currentQuads = await quadStorage.findQuads([]);
      const newQuads = quadsFromStore(store);
      const currentQuadSet = new Set(currentQuads.map(storedQuadKey));
      const newQuadSet = new Set(newQuads.map(storedQuadKey));
      const toRemove = currentQuads.filter((q: StoredQuad) =>
        !newQuadSet.has(storedQuadKey(q))
      );
      const toAdd = newQuads.filter((q: StoredQuad) =>
        !currentQuadSet.has(storedQuadKey(q))
      );
      if (toRemove.length > 0 || toAdd.length > 0) {
        await this.assertOwnsWorld(ref, "write");
        await this.withLock(ref, async () => {
          if (toRemove.length > 0) await quadStorage.deleteQuads(toRemove);
          if (toAdd.length > 0) await quadStorage.setQuads(toAdd);
        });
      }
      return null;
    }
    return result;
  }

  async search(input: SearchRequest): Promise<SearchResponse> {
    this.assertAuthenticated();
    const ref = resolveWorldReference(input.source);
    await this.assertOwnsWorld(ref, "read");

    const queryTerms = tokenizeSearchQuery(input.query);
    if (queryTerms.length === 0) return { results: [] };

    const indexState = await this.searchDeps.chunkIndexManager.getIndexState(
      ref,
    );

    // Hard error if index exists but dimensions mismatch (Production Hardening)
    if (indexState) {
      if (
        indexState.embeddingDimensions !== this.searchDeps.embeddings.dimensions
      ) {
        throw new InvalidArgumentError(
          `Embedding dimension mismatch for world ${input.source}. ` +
            `Index: ${indexState.embeddingDimensions}, Current: ${this.searchDeps.embeddings.dimensions}. ` +
            `Please re-index or update configuration.`,
        );
      }

      const currentModel =
        this.searchDeps.embeddings instanceof FakeEmbeddingsService
          ? undefined
          : (this.searchDeps.embeddings as OpenAIEmbeddingsService).model;

      if (
        indexState.embeddingModel && currentModel &&
        indexState.embeddingModel !== currentModel
      ) {
        throw new InvalidArgumentError(
          `Embedding model mismatch for world ${input.source}. ` +
            `Index: ${indexState.embeddingModel}, Current: ${currentModel}. ` +
            `Please re-index or update configuration to match the original model.`,
        );
      }
    }

    const results = indexState
      ? await this.searchChunks(input, ref)
      : await searchNaiveFts({
        targetRef: ref,
        queryTerms,
        queryText: input.query,
        subjects: input.subjects,
        predicates: input.predicates,
        types: input.types,
        quadStorageManager: this.quadStorageManager,
        worldStorage: this.worldStorage,
      });

    const pageSizeRaw = input.pageSize === undefined || input.pageSize === 0
      ? DEFAULT_SEARCH_PAGE_SIZE
      : input.pageSize < 0
      ? (() => {
        throw new InvalidArgumentError("Invalid page size");
      })()
      : input.pageSize;
    const pageSize = Math.min(pageSizeRaw, MAX_PAGE_SIZE);

    const normalizeStringArray = (arr?: string[]) =>
      (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0).sort();

    const sig = await signPageTokenParams({
      method: "searchWorlds",
      query: input.query,
      source: formatWorldName(ref),
      subjects: normalizeStringArray(input.subjects),
      predicates: normalizeStringArray(input.predicates),
      types: normalizeStringArray(input.types),
    });

    const decoded = input.pageToken?.trim()
      ? decodePageToken(input.pageToken.trim())
      : null;
    if (decoded) assertPageTokenSig(decoded, sig);

    const startIndex = decoded?.o ?? 0;
    const paginated = results.slice(startIndex, startIndex + pageSize);
    const nextPageToken = startIndex + pageSize < results.length
      ? encodePageToken({ v: 1, o: startIndex + pageSize, sig })
      : undefined;

    return { results: paginated, nextPageToken };
  }

  /**
   * Vector + full-text search over per-world ChunkIndex indexes.
   * Absorbed from chunks-search-engine.ts to eliminate pass-through module.
   */
  private async searchChunks(
    input: SearchRequest,
    targetRef: WorldReference,
  ): Promise<SearchResult[]> {
    const queryTerms = tokenizeSearchQuery(input.query);
    const queryVector = await this.searchDeps.embeddings.embed(input.query);
    const index = await this.searchDeps.chunkIndexManager.getChunkIndex(
      targetRef,
    );
    const rows = await index.search({
      queryText: input.query,
      queryTerms,
      queryVector,
      subjects: input.subjects,
      predicates: input.predicates,
      types: input.types,
      mode: input.mode as "hybrid" | "vector" | "fts" | undefined,
      weights: input.weights
        ? {
          vector: input.weights.vector ?? 1.0,
          fts: input.weights.fts ?? 1.0,
        }
        : undefined,
    });

    const stored = await this.worldStorage.getWorld(targetRef);
    const world: World = {
      name: formatWorldName(targetRef),
      namespace: targetRef.namespace,
      id: targetRef.id,
      displayName: stored?.displayName ?? "",
      description: stored?.description,
      createTime: stored?.createTime ?? 0,
    };

    return rows.map((row) => ({
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      vecRank: row.vecRank,
      ftsRank: row.ftsRank,
      score: row.score,
      world,
    }));
  }

  async import(input: ImportWorldRequest): Promise<void> {
    const reference = resolveWorldReference(input.source);
    await this.assertOwnsWorld(reference, "write");
    return this.withLock(reference, async () => {
      const contentType = input.contentType || "application/n-quads";
      const data = typeof input.data === "string"
        ? input.data
        : new TextDecoder().decode(input.data);
      const quads = deserialize(data, contentType);
      const quadStorage = await this.quadStorageManager.getQuadStorage(
        reference,
      );
      await quadStorage.setQuads(quads);
    });
  }

  async export(input: ExportWorldRequest): Promise<ArrayBuffer> {
    const reference = resolveWorldReference(input.source);
    await this.assertOwnsWorld(reference, "read");
    const quadStorage = await this.quadStorageManager.getQuadStorage(reference);
    const quads = await quadStorage.findQuads([]);
    const contentType = input.contentType || "application/n-quads";
    const serialized = await serialize(quads, contentType);
    return new TextEncoder().encode(serialized).buffer as ArrayBuffer;
  }
}
