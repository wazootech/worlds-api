import type { StoredFact } from "#/worlds/rdf/facts/types.ts";

/**
 * Patch batch for RDF fact insertions and deletions.
 */
export interface Patch {
  insertions: StoredFact[];
  deletions: StoredFact[];
}

export interface PatchHandler {
  patch(patches: Patch[]): Promise<void>;
}
