import type { StoredQuad } from "./types.ts";

function inferredObjectTermType(q: StoredQuad): string {
  if (q.objectTermType) return q.objectTermType;
  if (q.object.startsWith("_:")) return "BlankNode";
  if (q.object.includes(":") || q.object.startsWith("urn:")) return "NamedNode";
  return "Literal";
}

/**
 * Stable identity key for storage/diffing. Include object term metadata so a
 * literal URL and a named-node URL do not collapse to the same fact.
 */
export function storedQuadKey(q: StoredQuad): string {
  return [
    q.subject,
    q.predicate,
    q.object,
    q.graph ?? "",
    inferredObjectTermType(q),
    q.objectDatatype ?? "",
    q.objectLanguage ?? "",
  ].join("|");
}
