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
    textSplitter?: any;
    searchIndexOnImport?: "incremental" | "deferred" | "disabled";
  }

  export function createCloudflareWorldsSdk(
    options: CloudflareWorldsSdkOptions,
  ): Promise<WorldsSdkInterface>;
}

declare module "@worlds/sdk" {
  export interface WorldsSdkInterface {
    sparql(options: {
      query: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    }): Promise<any>;
    search(options: {
      query: string;
      topK?: number;
      minScore?: number;
    }): Promise<{ results: any[] }>;
    import(options: { source: any }): Promise<void>;
    export(options: { format: any }): Promise<any>;
    reindex?(): Promise<void>;
  }
}
