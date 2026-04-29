import { DataFactory, Parser, Store } from "n3";
import type { BlankNode, NamedNode, Quad, Term } from "n3";
import { canonize } from "rdf-canonize";
import type { ContentType } from "#/api/openapi/generated/types.gen.ts";
import { resolveSkolemPrefix, skolemizeBlankNodeLabel } from "./skolem.ts";

/**
 * IngestOptions are the options for the ingestion.
 */
export interface IngestOptions {
  /**
   * skolemPrefix is the IRI prefix used when turning blank nodes into NamedNodes.
   *
   * Default: "urn:worlds:fact:"
   */
  skolemPrefix?: string;
}

function isBlankNodeTerm(term: Term): term is BlankNode {
  return term.termType === "BlankNode";
}

function skolemNamedNode(term: BlankNode, opts?: IngestOptions): NamedNode {
  const prefix = resolveSkolemPrefix(opts);
  const id = skolemizeBlankNodeLabel(`_:${term.value}`);
  return DataFactory.namedNode(`${prefix}${id}`);
}

/**
 * toSkolemizedQuad replaces any blank nodes in the quad with skolem NamedNodes.
 * This makes the resulting store safe to use in pipelines that prefer stable IRIs.
 */
export function toSkolemizedQuad(quad: Quad, opts?: IngestOptions): Quad {
  const s = isBlankNodeTerm(quad.subject)
    ? skolemNamedNode(quad.subject, opts)
    : quad.subject;
  const o = isBlankNodeTerm(quad.object)
    ? skolemNamedNode(quad.object, opts)
    : quad.object;
  const g = isBlankNodeTerm(quad.graph)
    ? skolemNamedNode(quad.graph, opts)
    : quad.graph;
  return DataFactory.quad(s, quad.predicate, o, g);
}

function n3FormatFromContentType(contentType: ContentType): string {
  switch (contentType) {
    case "application/n-quads":
      return "application/n-quads";
    case "application/n-triples":
      return "application/n-triples";
    case "text/turtle":
      return "text/turtle";
    default:
      // `ContentType` is currently a narrow union; keep a safe fallback.
      return "application/n-quads";
  }
}

/**
 * parseStoreFromRdfBytes parses an RDF/JS Store from a byte buffer.
 *
 * @param data - The byte buffer containing the RDF/JS data.
 * @param contentType - The content type of the RDF/JS data.
 * @param options - The options for the ingestion.
 * @returns The parsed RDF/JS Store.
 */
export async function parseStoreFromRdfBytes(
  data: ArrayBuffer,
  contentType: ContentType,
  options?: IngestOptions,
): Promise<Store> {
  const text = new TextDecoder().decode(data);
  const parser = new Parser({ format: n3FormatFromContentType(contentType) });

  const parsed = parser.parse(text) as Quad[];

  // Canonicalize the dataset first so blank node labels are deterministic for this snapshot.
  // This avoids relying on parser-local _: labels (which are not stable identifiers).
  const canonicalNQuads = await canonize(parsed, {
    algorithm: "RDFC-1.0",
    format: "application/n-quads",
  });

  const canonicalParser = new Parser({ format: "application/n-quads" });
  const canonicalQuads = canonicalParser.parse(canonicalNQuads) as Quad[];

  const quads = canonicalQuads.map((q: Quad) => toSkolemizedQuad(q, options));
  const store = new Store();
  store.addQuads(quads);
  return store;
}
