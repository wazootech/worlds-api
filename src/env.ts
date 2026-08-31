export type Env = {
  /** D1 database binding (single database for control plane + per-world data). */
  DB: import("@cloudflare/workers-types").D1Database;
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
