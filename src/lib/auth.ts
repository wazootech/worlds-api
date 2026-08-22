import { getDb } from "./db";
import type { Env } from "../env";
import { sha256Hex } from "./crypto";

export const SCOPE_DATA_READ = "data:read";
export const SCOPE_DATA_WRITE = "data:write";

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

export function forbidden(): Response {
  return Response.json(
    { error: { code: "FORBIDDEN", message: "Insufficient access" } },
    { status: 403 },
  );
}

export function forbiddenScope(scope: string): Response {
  return Response.json(
    {
      error: {
        code: "FORBIDDEN",
        message: `This API key does not have the '${scope}' scope`,
      },
    },
    { status: 403 },
  );
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

  if (env.WORLDS_ADMIN_KEY && token === env.WORLDS_ADMIN_KEY) {
    return { admin: true };
  }

  const db = getDb(env);
  const hash = await sha256Hex(token);

  try {
    const rs = await db.execute({
      sql: "SELECT namespace, world_id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
      args: [hash],
    });

    if (rs.rows.length === 0) {
      return { admin: false };
    }

    const namespace = rs.rows[0][0] as string;
    const worldId = rs.rows[0][1] as string | null;
    const scopesRaw = rs.rows[0][2] as string | null;
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

  if (!auth.namespace) {
    return unauthorized();
  }

  if (auth.namespace !== namespace) {
    return forbidden();
  }

  if (worldId && auth.worldId && auth.worldId !== worldId) {
    return forbidden();
  }

  if (requiredScope && !auth.scopes?.includes(requiredScope)) {
    return forbiddenScope(requiredScope);
  }

  return null;
}
