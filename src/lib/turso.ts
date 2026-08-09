import type { Env } from "../env";

type CreateDatabaseResponse = {
  database?: {
    Hostname?: string;
    hostname?: string;
    Name?: string;
    name?: string;
  };
  error?: string;
};

type CreateTokenResponse = {
  jwt?: string;
  error?: string;
};

export type ProvisionedWorldDatabase = {
  name: string;
  url: string;
  authToken: string;
};

/**
 * Provisions a per-world Turso database and mints a database auth token.
 * The returned database name is derived from the canonical world_uid so the
 * same world_uid always maps to the same Turso database name, making retries
 * idempotent at the platform layer (allowConflict).
 */
export async function provisionWorldDatabase(
  env: Env,
  worldUid: string,
): Promise<ProvisionedWorldDatabase> {
  const org = env.TURSO_ORG;
  const group = env.TURSO_GROUP;
  const token = env.TURSO_PLATFORM_API_TOKEN;
  if (!org || !group || !token) {
    throw new Error("Turso provisioning is not configured");
  }

  const name = databaseName(env.WAZOO_ENV ?? "prod", worldUid);
  const database = await turso<CreateDatabaseResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases`,
    {
      method: "POST",
      body: { name, group },
      allowConflict: true,
    },
  );
  const hostname = database.database?.Hostname ?? database.database?.hostname;
  const url = hostname ? `libsql://${hostname}` : await databaseUrl(env, name);

  const auth = await turso<CreateTokenResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}/auth/tokens?authorization=full-access&expiration=never`,
    { method: "POST" },
  );
  if (!auth.jwt) {
    throw new Error("Turso did not return a database auth token");
  }
  return { name, url, authToken: auth.jwt };
}

/**
 * Destroys a per-world Turso database. This also invalidates every token
 * minted against it, so a purged world leaves no live credentials behind.
 */
export async function destroyWorldDatabase(env: Env, name: string) {
  const org = env.TURSO_ORG;
  const token = env.TURSO_PLATFORM_API_TOKEN;
  if (!org || !token) {
    throw new Error("Turso provisioning is not configured");
  }
  await turso<unknown>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

async function databaseUrl(env: Env, name: string): Promise<string> {
  const org = env.TURSO_ORG!;
  const response = await turso<CreateDatabaseResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}`,
    { method: "GET" },
  );
  const hostname = response.database?.Hostname ?? response.database?.hostname;
  if (!hostname) {
    throw new Error("Turso did not return a database hostname");
  }
  return `libsql://${hostname}`;
}

async function turso<T>(
  env: Env,
  path: string,
  options: {
    method: "GET" | "POST" | "DELETE";
    body?: unknown;
    allowConflict?: boolean;
  },
): Promise<T> {
  const response = await fetch(`https://api.turso.tech${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${env.TURSO_PLATFORM_API_TOKEN}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text
    ? (JSON.parse(text) as T & { error?: string })
    : ({} as T & { error?: string });
  if (!response.ok && !(options.allowConflict && response.status === 409)) {
    throw new Error(body.error ?? `Turso API returned ${response.status}`);
  }
  return body;
}

export function databaseName(envName: string, worldUid: string): string {
  return `wz-${envName}-${worldUid}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
