import type { Source, WorldReference } from "#/openapi/generated/types.gen.ts";

/**
 * WorldRefError is an error that occurs when a world reference is invalid.
 */
export class WorldRefError extends Error {
  /**
   * The name of the error.
   */
  override name = "WorldRefError";
}

/**
 * formatWorldName formats a canonical world resource name used by this API.
 *
 * We intentionally require both namespace and id (no defaults).
 */
export function formatWorldName(reference: WorldReference): string {
  return `${reference.namespace}/${reference.id}`;
}

/**
 * Parse a canonical world resource name.
 *
 * Required format: "{namespace}/{id}"
 */
export function parseWorldName(name: string): WorldReference {
  if (!name || typeof name !== "string") {
    throw new WorldRefError("World name must be a non-empty string");
  }

  const trimmed = name.trim();
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    throw new WorldRefError(
      `Invalid world name "${name}". Expected "{namespace}/{id}"`,
    );
  }

  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new WorldRefError(
      `Invalid world name "${name}". Expected "{namespace}/{id}"`,
    );
  }

  const namespace = parts[0]?.trim();
  const id = parts[1]?.trim();

  if (!namespace) {
    throw new WorldRefError(
      `Invalid world name "${name}". Namespace is required`,
    );
  }
  if (!id) {
    throw new WorldRefError(`Invalid world name "${name}". Id is required`);
  }

  return { namespace, id };
}

/**
 * Resolve a world ref from a Source.
 *
 * Strict rules:
 * - If Source is a string, it MUST be a canonical world name.
 * - If Source is an object, it MUST contain both namespace and id.
 */
export function resolveWorldRefFromSource(source: Source): WorldReference {
  if (typeof source === "string") {
    return parseWorldName(source);
  }

  const namespace = source.namespace?.trim();
  const id = source.id?.trim();

  if (!namespace) {
    throw new WorldRefError(
      "World source must include a non-empty namespace (no default namespace)",
    );
  }
  if (!id) {
    throw new WorldRefError(
      "World source must include a non-empty id (no default world)",
    );
  }

  return { namespace, id };
}
