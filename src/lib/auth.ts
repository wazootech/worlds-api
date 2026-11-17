import { getDb } from "./db";
import type { Env } from "../env";
import { sha256Hex } from "./crypto";

export const SCOPE_DATA_READ = "data:read";
export const SCOPE_DATA_WRITE = "data:write";
/** Manage the namespace embedding credential. Never in the default grant. */
export const SCOPE_EMBEDDINGS_ADMIN = "embeddings:admin";

export type AuthResult = {
  admin: boolean;
  namespace?: string;
  worldId?: string;
  scopes?: string[];
};

export function unauthorized(): Response {
  return Response.json(
    {
      error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
    },
    { status: 401 },
  );
}

export function forbidden(message: string): Response {
  return Response.json(
    { error: { code: "FORBIDDEN", message } },
    { status: 403 },
  );
}

// John: I'm keeping this function around to keep changes to a minimal when resolving this issue:
// https://github.com/wazootech/worlds-api/issues/178
// If we somehow we want to minimize functions to maintain, delete this and use forbidden() instead
export function forbiddenScope(scope: string): Response {
  return forbidden(`This API key does not have the '${scope}' scope`);
}

export function hasScope(auth: AuthResult, scope: string): boolean {
  if (auth.admin) return true;
  return Boolean(auth.scopes?.includes(scope));
}

export async function authorize(
  request: Request,
  env: Env,
): Promise<AuthResult> {
  const header = request.headers.get("Authorization");

  if (!header?.startsWith("Bearer ")) {
    return { admin: false };
  }

  const token = header.slice("Bearer ".length).trim();

  if (env.WORLDS_API_ADMIN_KEY && token === env.WORLDS_API_ADMIN_KEY) {
    return { admin: true };
  }

  const db = getDb(env);
  const hash = await sha256Hex(token);

  try {
    const stmt = db
      .prepare(
        "SELECT namespace, world_id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
      )
      .bind(hash);
    const rs = await stmt.all<{
      namespace: string;
      world_id: string | null;
      scopes: string | null;
    }>();

    if (rs.results.length === 0) {
      return { admin: false };
    }

    const row = rs.results[0];
    const namespace = row.namespace;
    const worldId = row.world_id;
    const scopesRaw = row.scopes;
    let scopes: string[] = [SCOPE_DATA_READ, SCOPE_DATA_WRITE];
    if (scopesRaw) {
      try {
        const parsed = JSON.parse(scopesRaw);
        if (Array.isArray(parsed)) {
          scopes = parsed.filter((s): s is string => typeof s === "string");
        }
      } catch {
        // Malformed scopes JSON falls back to the default grant.
      }
    }

    return {
      admin: false,
      namespace,
      worldId: worldId ?? undefined,
      scopes,
    };
  } catch {
    return { admin: false };
  }
}

export function requireAccess(
  auth: AuthResult,
  namespace: string,
  worldId?: string,
  requiredScope?: string,
): Response | null {
  if (auth.admin) return null;

  if (worldId === "") return unauthorized();

  if (!auth.namespace) {
    return unauthorized();
  }

  if (auth.namespace !== namespace) {
    return forbidden("This API key belongs to a different namespace");
  }

  if (worldId && auth.worldId && auth.worldId !== worldId) {
    return forbidden("This API key is scoped to a different world");
  }

  if (requiredScope && !auth.scopes?.includes(requiredScope)) {
    return forbiddenScope(requiredScope);
  }

  return null;
}
