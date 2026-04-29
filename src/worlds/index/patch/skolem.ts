import type { StoredFact } from "#/worlds/rdf/facts/types.ts";
import { storedFactToN3 } from "#/worlds/rdf/rdf.ts";
import { skolemizeQuad } from "#/worlds/rdf/skolem.ts";

export { storedFactToN3 } from "#/worlds/rdf/rdf.ts";

/**
 * Stable base64url fact id from RDFC-1.0 canonicalization.
 */
export async function skolemizeStoredFact(fact: StoredFact): Promise<string> {
  return skolemizeQuad(storedFactToN3(fact));
}
