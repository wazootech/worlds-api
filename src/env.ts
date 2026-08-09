export type Env = {
  LIBSQL_URL: string;
  LIBSQL_AUTH_TOKEN?: string;
  WORLDS_ADMIN_KEY?: string;
  TURSO_ORG?: string;
  TURSO_GROUP?: string;
  TURSO_PLATFORM_API_TOKEN?: string;
  WAZOO_ENV?: string;
  PORT?: string;
};

export function fromBindings(env: Record<string, unknown>): Env {
  return {
    LIBSQL_URL: String(env.LIBSQL_URL ?? ""),
    LIBSQL_AUTH_TOKEN: env.LIBSQL_AUTH_TOKEN
      ? String(env.LIBSQL_AUTH_TOKEN)
      : undefined,
    WORLDS_ADMIN_KEY: env.WORLDS_ADMIN_KEY
      ? String(env.WORLDS_ADMIN_KEY)
      : undefined,
    TURSO_ORG: env.TURSO_ORG ? String(env.TURSO_ORG) : undefined,
    TURSO_GROUP: env.TURSO_GROUP ? String(env.TURSO_GROUP) : undefined,
    TURSO_PLATFORM_API_TOKEN: env.TURSO_PLATFORM_API_TOKEN
      ? String(env.TURSO_PLATFORM_API_TOKEN)
      : undefined,
    WAZOO_ENV: env.WAZOO_ENV ? String(env.WAZOO_ENV) : undefined,
    PORT: env.PORT ? String(env.PORT) : undefined,
  };
}

export function fromProcessEnv(): Env {
  return {
    LIBSQL_URL: process.env.LIBSQL_URL ?? "",
    LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
    WORLDS_ADMIN_KEY: process.env.WORLDS_ADMIN_KEY,
    TURSO_ORG: process.env.TURSO_ORG,
    TURSO_GROUP: process.env.TURSO_GROUP,
    TURSO_PLATFORM_API_TOKEN: process.env.TURSO_PLATFORM_API_TOKEN,
    WAZOO_ENV: process.env.WAZOO_ENV,
    PORT: process.env.PORT,
  };
}
