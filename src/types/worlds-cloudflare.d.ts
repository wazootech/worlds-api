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
    worldUid?: string;
    textSplitter?: any;
    searchIndexOnImport?: "incremental" | "deferred" | "disabled";
    /**
     * candidateCount sizes the search-index candidate pool at the SQL level
     * (provider-internal per the hosted search contract, worlds-api#30 D2).
     * Routes pass max(limit, world.topK); defaults to the search index's limit
     * (100) when unset.
     */
    candidateCount?: number;
  }

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
    ): Promise<{ results?: SearchResult[] }>;
    import(options: { source: any }): Promise<void>;
    export(options: { format: any }): Promise<any>;
    reindex?(): Promise<void>;
  }
}
