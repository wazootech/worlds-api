import type { StoredQuad } from "#/worlds/store/quad/types.ts";
import { storedQuadToN3 } from "#/worlds/rdf/rdf.ts";
import { skolemizeQuad } from "#/worlds/rdf/skolem.ts";

export { storedQuadToN3 } from "#/worlds/rdf/rdf.ts";

/**
 * Stable base64url fact id from RDFC-1.0 canonicalization (same as {@link skolemizeQuad} on N3 quads).
 */
export async function skolemizeStoredQuad(quad: StoredQuad): Promise<string> {
  return skolemizeQuad(storedQuadToN3(quad));
}
