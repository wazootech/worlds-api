export type Env = {
  /** D1 database binding (single database for control plane + per-world data). */
  DB: import("@cloudflare/workers-types").D1Database;
  /**
   * Vectorize binding for the outside-D1 vector index (Phase C, worlds-api#1).
   * When set, worlds-api threads it into the search SDK; hybrid/semantic search
   * activates only once an embedding source is also configured
   * (BYOK per-world keys; a world needs an active credential and a ready
   * embedding state). Without it, search stays keyword-only (graceful per
   * engine design).
   */
  VECTORIZE_INDEX?: import("@cloudflare/workers-types").VectorizeIndex;
  /**
   * Key-encryption keys for customer embedding credentials: base64 of 32
   * random bytes, delivered as Worker secrets by the Infisical sync (see
   * `secret-registry.md`). Writes use the highest configured version; reads
   * use the version stored on the record. Absent or malformed means the
   * credential store fails closed (keyword-only search, credential routes 503).
   */
  EMBEDDING_KEK_V1?: string;
  EMBEDDING_KEK_V2?: string;
  /**
   * Write pool: max texts embedded per namespace per UTC day by import and
   * reindex (default 20000). Enforced in D1 before the provider is called.
   */
  EMBEDDING_DAILY_BUDGET?: string;
  /**
   * Max D1 rows one namespace's data plane may write per UTC day, index
   * entries included. Opt-in: unset disables it. Soft limit: a write is
   * refused with 429 WRITE_BUDGET_EXCEEDED once the budget is already used.
   * Protects the shared database (and the account's D1 quota) from one tenant.
   */
  NAMESPACE_DAILY_ROW_WRITE_BUDGET?: string;
  /**
   * Query pool: max search-time query embeds per namespace per UTC day
   * (default 5000). Separate from the write pool so search traffic cannot
   * starve import and reindex; exhaustion degrades search to keyword.
   */
  EMBEDDING_DAILY_QUERY_BUDGET?: string;
  /**
   * Max texts one reindex call may embed (default 5000). Larger worlds are
   * reindexed in windows across several calls (each resumes where the last
   * finished) instead of failing.
   */
  EMBEDDING_REINDEX_MAX_CHUNKS?: string;
  /**
   * Platform→data-plane admin key. The name is canonical platform-wide: the
   * value lives in Infisical as `WORLDS_API_ADMIN_KEY` for `qa` and `prod`, is
   * chosen by each developer for local runs, and is delivered to the deployed
   * Worker by the Cloudflare
   * Workers Secret Sync. `src/lib/auth.ts` accepts it as `{ admin: true }`,
   * bypassing `api_keys`.
   */
  WORLDS_API_ADMIN_KEY?: string;
  WAZOO_ENV?: string;
  PORT?: string;
  // Abuse-prevention knobs (all optional, defaults applied in code).
  SPARQL_TIMEOUT_MS?: string;
  SPARQL_MAX_QUERY_LENGTH?: string;
  SPARQL_MAX_RESULTS?: string;
  MAX_IMPORT_BYTES?: string;
  MAX_IMPORT_QUADS?: string;
  RATE_LIMIT_RPM?: string;
  RATE_LIMIT_BURST?: string;
  CORS_ORIGINS?: string;
};

export function fromBindings(env: Record<string, unknown>): Env {
  return {
    DB: env.DB as import("@cloudflare/workers-types").D1Database,
    VECTORIZE_INDEX: env.VECTORIZE_INDEX as
      import("@cloudflare/workers-types").VectorizeIndex | undefined,
    EMBEDDING_KEK_V1: env.EMBEDDING_KEK_V1
      ? String(env.EMBEDDING_KEK_V1)
      : undefined,
    EMBEDDING_KEK_V2: env.EMBEDDING_KEK_V2
      ? String(env.EMBEDDING_KEK_V2)
      : undefined,
    EMBEDDING_DAILY_BUDGET: env.EMBEDDING_DAILY_BUDGET
      ? String(env.EMBEDDING_DAILY_BUDGET)
      : undefined,
    EMBEDDING_DAILY_QUERY_BUDGET: env.EMBEDDING_DAILY_QUERY_BUDGET
      ? String(env.EMBEDDING_DAILY_QUERY_BUDGET)
      : undefined,
    EMBEDDING_REINDEX_MAX_CHUNKS: env.EMBEDDING_REINDEX_MAX_CHUNKS
      ? String(env.EMBEDDING_REINDEX_MAX_CHUNKS)
      : undefined,
    WORLDS_API_ADMIN_KEY: env.WORLDS_API_ADMIN_KEY
      ? String(env.WORLDS_API_ADMIN_KEY)
      : undefined,
    WAZOO_ENV: env.WAZOO_ENV ? String(env.WAZOO_ENV) : undefined,
    PORT: env.PORT ? String(env.PORT) : undefined,
    SPARQL_TIMEOUT_MS: env.SPARQL_TIMEOUT_MS
      ? String(env.SPARQL_TIMEOUT_MS)
      : undefined,
    SPARQL_MAX_QUERY_LENGTH: env.SPARQL_MAX_QUERY_LENGTH
      ? String(env.SPARQL_MAX_QUERY_LENGTH)
      : undefined,
    SPARQL_MAX_RESULTS: env.SPARQL_MAX_RESULTS
      ? String(env.SPARQL_MAX_RESULTS)
      : undefined,
    MAX_IMPORT_BYTES: env.MAX_IMPORT_BYTES
      ? String(env.MAX_IMPORT_BYTES)
      : undefined,
    MAX_IMPORT_QUADS: env.MAX_IMPORT_QUADS
      ? String(env.MAX_IMPORT_QUADS)
      : undefined,
    RATE_LIMIT_RPM: env.RATE_LIMIT_RPM ? String(env.RATE_LIMIT_RPM) : undefined,
    RATE_LIMIT_BURST: env.RATE_LIMIT_BURST
      ? String(env.RATE_LIMIT_BURST)
      : undefined,
    CORS_ORIGINS: env.CORS_ORIGINS ? String(env.CORS_ORIGINS) : undefined,
  };
}

/** Bindings miniflare injects on globalThis for local development. */
interface LocalBindingGlobals {
  __D1_DATABASE__?: unknown;
  __VECTORIZE_INDEX__?: unknown;
}

export function fromProcessEnv(): Env {
  // D1 bindings aren't available via process.env — this path is only used
  // for local development with miniflare, where DB is injected at runtime.
  return {
    DB: (globalThis as LocalBindingGlobals)
      .__D1_DATABASE__ as import("@cloudflare/workers-types").D1Database,
    VECTORIZE_INDEX: (globalThis as LocalBindingGlobals).__VECTORIZE_INDEX__ as
      import("@cloudflare/workers-types").VectorizeIndex | undefined,
    EMBEDDING_KEK_V1: process.env.EMBEDDING_KEK_V1,
    EMBEDDING_KEK_V2: process.env.EMBEDDING_KEK_V2,
    EMBEDDING_DAILY_BUDGET: process.env.EMBEDDING_DAILY_BUDGET,
    EMBEDDING_DAILY_QUERY_BUDGET: process.env.EMBEDDING_DAILY_QUERY_BUDGET,
    EMBEDDING_REINDEX_MAX_CHUNKS: process.env.EMBEDDING_REINDEX_MAX_CHUNKS,
    WORLDS_API_ADMIN_KEY: process.env.WORLDS_API_ADMIN_KEY,
    WAZOO_ENV: process.env.WAZOO_ENV,
    PORT: process.env.PORT,
    SPARQL_TIMEOUT_MS: process.env.SPARQL_TIMEOUT_MS,
    SPARQL_MAX_QUERY_LENGTH: process.env.SPARQL_MAX_QUERY_LENGTH,
    SPARQL_MAX_RESULTS: process.env.SPARQL_MAX_RESULTS,
    MAX_IMPORT_BYTES: process.env.MAX_IMPORT_BYTES,
    MAX_IMPORT_QUADS: process.env.MAX_IMPORT_QUADS,
    RATE_LIMIT_RPM: process.env.RATE_LIMIT_RPM,
    RATE_LIMIT_BURST: process.env.RATE_LIMIT_BURST,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
  };
}
