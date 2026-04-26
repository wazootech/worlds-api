/**
 * StoredQuad is the internal quad representation used by the store layer.
 * Simpler than the wire format (SparqlQuad) which includes type wrappers.
 */
export interface StoredQuad {
  subject: string;
  predicate: string;
  object: string;
  graph: string;
}