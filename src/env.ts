export type Env = {
  LIBSQL_URL: string;
  LIBSQL_AUTH_TOKEN?: string;
  WORLDS_ADMIN_KEY?: string;
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
    PORT: env.PORT ? String(env.PORT) : undefined,
  };
}

export function fromProcessEnv(): Env {
  return {
    LIBSQL_URL: process.env.LIBSQL_URL ?? "",
    LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
    WORLDS_ADMIN_KEY: process.env.WORLDS_ADMIN_KEY,
    PORT: process.env.PORT,
  };
}
