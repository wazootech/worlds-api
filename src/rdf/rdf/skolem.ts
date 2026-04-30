import type { StoredFact } from "#/rdf/storage/types.ts";
import type { Quad } from "n3";
import { canonize } from "rdf-canonize";
import { encodeBase64Url } from "@std/encoding/base64url";
import { storedFactToN3 } from "#/rdf/rdf/rdf.ts";

function opaqueIdFromText(text: string): string {
  const encoded = new TextEncoder().encode(text);
  return encodeBase64Url(encoded);
}

export interface SkolemOptions {
  /**
   * skolemPrefix is the IRI prefix used when turning blank nodes into NamedNodes.
   *
   * Default: "urn:worlds:fact:"
   */
  skolemPrefix?: string;
}

/**
 * resolveSkolemPrefix resolves the skolem prefix from the options.
 */
export function resolveSkolemPrefix(opts?: SkolemOptions): string {
  return opts?.skolemPrefix ?? "urn:worlds:fact:";
}

/**
 * skolemizeQuad skolemizes an RDF/JS Quad to a base64url-encoded
 * RDFC-1.0 unique canonical identifier.
 */
export async function skolemizeQuad(quad: Quad): Promise<string> {
  const canonical = await canonizeQuad(quad);
  return opaqueIdFromText(canonical);
}

/**
 * Stable id for a {@link StoredFact}: RDFC-1.0 canonicalization of the same triple
 * {@link storedFactToN3} produces for the RDF store.
 */
export async function skolemizeStoredFact(fact: StoredFact): Promise<string> {
  return skolemizeQuad(storedFactToN3(fact));
}

/**
 * canonizeQuad canonizes an RDF/JS Quad to RDFC-1.0.
 *
 * @see https://www.w3.org/TR/rdf-canon
 */
export async function canonizeQuad(quad: Quad): Promise<string> {
  return await canonize([quad], {
    algorithm: "RDFC-1.0",
    format: "application/n-quads",
  });
}

/**
 * skolemizeBlankNodeLabel creates a stable id for a blank node label.
 *
 * Note: RDF blank node identifiers are scoped to the source document. This
 * function intentionally derives a stable id from the label alone; callers
 * can include additional scoping information in the label if needed.
 */
export function skolemizeBlankNodeLabel(label: string): string {
  return opaqueIdFromText(label);
}
