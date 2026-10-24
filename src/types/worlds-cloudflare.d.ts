/**
 * Type declarations for @worlds/cloudflare.
 *
 * The actual package is a Deno project (../worlds-cloudflare) that can't be
 * type-checked from Node/TypeScript. These declarations provide the minimal
 * type surface needed by worlds-api.
 */
declare module "@worlds/cloudflare" {
  import type { D1Database } from "@cloudflare/workers-types";
  import type { WorldsSdkInterface } from "@worlds/sdk";

  export interface CloudflareWorldsSdkOptions {
    database: D1Database;
    vectorDimensions?: number;
    matchPageSize?: number;
    maxLookupChunkSize?: number;
    maxWriteBatchSize?: number;
    worldId?: string;
    /**
     * Quad filters applied to commits and to reindex. worlds-api uses
     * `include.subjects` to window a large reindex across several calls.
     */
    include?: {
      subjects?: string[];
      predicates?: string[];
      graphs?: string[];
    };
    exclude?: {
      subjects?: string[];
      predicates?: string[];
      graphs?: string[];
    };
    /**
     * Opt-in OWL 2 RL materialization on write (@worlds/cloudflare, after
     * 0.10.1). Needs the `quads.derived` column. Older published versions
     * ignore this option.
     */
    inference?: {
      enabled: boolean;
      graphs?: "per-graph" | "union";
      maxAssertedQuads?: number;
    };
    textSplitter?: any;
    searchIndexOnImport?: "incremental" | "deferred" | "disabled";
    /**
     * candidateCount sizes the search-index candidate pool at the SQL level
     * (provider-internal per the hosted search contract, worlds-api#30 D2).
     * Routes pass max(limit, world.topK); defaults to the search index's limit
     * (100) when unset.
     */
    candidateCount?: number;
    /**
     * Vectorize binding for hybrid/semantic search (Phase C, worlds-api#1).
     * Minimal duck-typed surface matching VectorizeIndexLike in the real
     * package (same convention as D1DatabaseLike).
     */
    vectorize?: {
      query(
        vector: number[],
        options?: {
          topK?: number;
          filter?: Record<string, string>;
          returnValues?: boolean;
          returnMetadata?: boolean;
        },
      ): Promise<{
        matches: Array<{
          id: string;
          score: number;
          // unknown keeps the real VectorizeIndex assignable (workers-types'
          // VectorizeMatch.metadata is VectorizeVectorMetadata).
          metadata?: unknown;
        }>;
        count: number;
      }>;
      upsert(
        vectors: Array<{
          id: string;
          values: number[];
          metadata?: Record<string, string>;
        }>,
      ): Promise<unknown>;
      deleteByIds(ids: string[]): Promise<unknown>;
    };
    /**
     * Embedding service that turns chunk text into query/chunk vectors. Only
     * active together with `vectorize` — otherwise search is keyword-only.
     */
    embeddingService?: {
      embed(inputs: string[]): Promise<number[][]>;
    };
  }

  /** Deterministic contract search-result id of a chunk. */
  export function buildSearchResultId(options: {
    subject: string;
    predicate: string;
    graph: string;
    text: string;
  }): Promise<string>;

  export function createCloudflareWorldsSdk(
    options: CloudflareWorldsSdkOptions,
  ): Promise<WorldsSdkInterface>;
}

declare module "@worlds/sdk" {
  export interface QuadFilterValue {
    subjects?: string[];
    predicates?: string[];
    graphs?: string[];
  }

  export interface QuadFilter {
    include?: QuadFilterValue;
    exclude?: QuadFilterValue;
  }

  export interface SearchResult {
    id: string;
    subject: string;
    predicate: string;
    graph: string;
    text: string;
    score: number;
    scoreType?: "rrf" | "cosine" | "unranked";
  }

  export type SearchMode = "semantic" | "keyword" | "hybrid" | "fallback";

  export interface WorldsSdkInterface {
    sparql(options: {
      query: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    }): Promise<any>;
    search(
      options: {
        query: string;
        minScore?: number;
      } & QuadFilter,
    ): Promise<{ results?: SearchResult[]; mode?: SearchMode }>;
    import(options: { source: any }): Promise<void>;
    export(options: { format: any }): Promise<any>;
    reindex?(): Promise<void>;
  }
}
