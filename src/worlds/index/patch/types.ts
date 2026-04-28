import type { StoredQuad } from "#/worlds/rdf/quads/types.ts";

/**
 * Patch batch for RDF quad insertions and deletions.
 */
export interface Patch {
  insertions: StoredQuad[];
  deletions: StoredQuad[];
}

export interface PatchHandler {
  patch(patches: Patch[]): Promise<void>;
}
