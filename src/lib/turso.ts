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

/** Default org-wide Turso database cap for the current plan (100). */
export const DEFAULT_MAX_DATABASES = 100;

/**
 * Thrown when the org is at its database-plan capacity, either from our own
 * pre-flight count or from Turso rejecting the create at the limit.
 */
export class DatabaseLimitError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(
      `The organization has reached its database limit (${limit}). Delete unused worlds or raise the database limit before creating more.`,
    );
    this.name = "DatabaseLimitError";
    this.limit = limit;
  }
}

/** Resolves the org-wide database cap, defaulting to 100 (current plan). */
export function maxDatabases(env: Env): number {
  const raw = env.MAX_DATABASES;
  if (!raw) return DEFAULT_MAX_DATABASES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_DATABASES;
  return parsed;
}

/**
 * Counts the databases currently provisioned in the Turso organization. The
 * plan cap is org-wide (all groups and environments share the budget), so this
 * counts everything the platform API lists.
 */
export async function countOrganizationDatabases(env: Env): Promise<number> {
  const org = env.TURSO_ORG;
  if (!org) throw new Error("Turso provisioning is not configured");

  let count = 0;
  let cursor: string | undefined;
  do {
    const query = cursor
      ? `?limit=1000&cursor=${encodeURIComponent(cursor)}`
      : "?limit=1000";
    const body = await turso<{ databases?: unknown[] }>(
      env,
      `/v1/organizations/${encodeURIComponent(org)}/databases${query}`,
      { method: "GET" },
    );
    count += body.databases?.length ?? 0;
    cursor = (body as { next_page_token?: string }).next_page_token;
  } while (cursor);
  return count;
}

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

  const limit = maxDatabases(env);
  const count = await countOrganizationDatabases(env);
  if (count >= limit) {
    throw new DatabaseLimitError(limit);
  }

  const name = databaseName(env.WAZOO_ENV ?? "prod", worldUid);
  let database: CreateDatabaseResponse;
  try {
    database = await turso<CreateDatabaseResponse>(
      env,
      `/v1/organizations/${encodeURIComponent(org)}/databases`,
      {
        method: "POST",
        body: { name, group },
        allowConflict: true,
      },
    );
  } catch (err) {
    // Backstop for the race between our pre-flight count and the create:
    // Turso may still reject at the plan cap. Surface it as the same clean
    // capacity error instead of a generic provisioning failure.
    const message = err instanceof Error ? err.message : String(err);
    if (
      /maximum database count|maximum number of databases|database limit/i.test(
        message,
      )
    ) {
      throw new DatabaseLimitError(limit);
    }
    throw err;
  }
  const hostname = database.database?.Hostname ?? database.database?.hostname;
  const url = hostname ? `libsql://${hostname}` : await databaseUrl(env, name);

  const auth = await turso<CreateTokenResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(
      name,
    )}/auth/tokens?authorization=full-access&expiration=never`,
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
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(
      name,
    )}`,
    { method: "DELETE" },
  );
}

async function databaseUrl(env: Env, name: string): Promise<string> {
  const org = env.TURSO_ORG!;
  const response = await turso<CreateDatabaseResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(
      name,
    )}`,
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
