import type { StoredFact } from "./types.ts";

function inferredObjectTermType(q: StoredFact): string {
  if (q.objectTermType) return q.objectTermType;
  if (q.object.startsWith("_:")) return "BlankNode";
  if (q.object.includes(":") || q.object.startsWith("urn:")) return "NamedNode";
  return "Literal";
}

export function storedFactKey(q: StoredFact): string {
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
