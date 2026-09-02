export type Env = {
  /** D1 database binding (single database for control plane + per-world data). */
  DB: import("@cloudflare/workers-types").D1Database;
  /**
   * Vectorize binding for the outside-D1 vector index (Phase C, worlds-api#1).
   * When set, worlds-api threads it into the search SDK; hybrid/semantic search
   * activates only once an embedding source is also configured
   * (EMBEDDING_PROVIDER — BYOK per-world keys are a pending #1 acceptance
   * criterion). Without it, search stays keyword-only (graceful per engine
   * design).
   */
  VECTORIZE_INDEX?: import("@cloudflare/workers-types").VectorizeIndex;
  /**
   * Which embedding provider supplies chunk/query vectors. Currently only
   * unset is supported (keyword-only); "workers-ai" / BYOK wiring is charted
   * under worlds-api#1. Present so deployments can fail loudly instead of
   * silently ignoring a configured provider that isn't implemented yet.
   */
  EMBEDDING_PROVIDER?: string;
  WORLDS_ADMIN_KEY?: string;
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
    EMBEDDING_PROVIDER: env.EMBEDDING_PROVIDER
      ? String(env.EMBEDDING_PROVIDER)
      : undefined,
    WORLDS_ADMIN_KEY: env.WORLDS_ADMIN_KEY
      ? String(env.WORLDS_ADMIN_KEY)
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

export function fromProcessEnv(): Env {
  // D1 bindings aren't available via process.env — this path is only used
  // for local development with miniflare, where DB is injected at runtime.
  return {
    DB: (globalThis as any)
      .__D1_DATABASE__ as import("@cloudflare/workers-types").D1Database,
    VECTORIZE_INDEX: (globalThis as any)?.__VECTORIZE_INDEX__ as
      import("@cloudflare/workers-types").VectorizeIndex | undefined,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    WORLDS_ADMIN_KEY: process.env.WORLDS_ADMIN_KEY,
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
