import type { StoredFact } from "#/facts/storage/types.ts";
import { storedFactToN3 } from "#/facts/rdf/rdf.ts";
import { skolemizeQuad } from "#/facts/rdf/skolem.ts";

export { storedFactToN3 } from "#/facts/rdf/rdf.ts";

/**
 * Stable base64url fact id from RDFC-1.0 canonicalization.
 */
export async function skolemizeStoredFact(fact: StoredFact): Promise<string> {
  return skolemizeQuad(storedFactToN3(fact));
}
