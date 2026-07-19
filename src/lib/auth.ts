import { getDb } from "./db";
import type { Env } from "../env";
import { sha256Hex } from "./crypto";

export type AuthResult = {
  admin: boolean;
  namespace?: string;
  worldId?: string;
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
      sql: "SELECT namespace, world_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
      args: [hash],
    });

    if (rs.rows.length === 0) {
      return { admin: false };
    }

    const namespace = rs.rows[0][0] as string;
    const worldId = rs.rows[0][1] as string | null;

    return {
      admin: false,
      namespace,
      worldId: worldId ?? undefined,
    };
  } catch {
    return { admin: false };
  }
}

export function requireAccess(
  auth: AuthResult,
  namespace: string,
  worldId?: string,
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

  return null;
}
