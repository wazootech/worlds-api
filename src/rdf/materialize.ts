/**
 * RDF materialization: parse bytes into an N3 {@link Store} after **dataset-wide**
 * RDFC-1.0 canonicalization, then replace blank nodes with skolem {@link NamedNode}s.
 *
 * **Not used by** {@link ../core/worlds.ts Worlds} **`import`**. Production import
 * uses {@link deserialize} in {@link ./rdf.ts} into `StoredQuad` storage. Use this
 * module when you need a query-friendly in-memory graph whose blank nodes are stable
 * IRIs (e.g. Comunica pipelines, tests, or future opt-in ingest paths).
 *
 * **Skolem strategies (do not conflate):**
 * - **Here (`toSkolemizedQuad`)**: after RDFC, each blank node label is turned into
 *   `resolveSkolemPrefix(opts)` + `skolemizeBlankNodeLabel(\`_:${label}\`)` — opaque id
 *   from the canonical label string.
 * - **`skolemizeStoredQuad` / `skolemizeQuad` in {@link ./skolem.ts}**: per-quad RDFC
 *   string hashed for **chunk index / storage keys**, not for rewriting graph terms.
 * - Some tests use yet another demo mapping (canonical N-Quad line bytes); that is
 *   illustrative only — see {@link ./sparql/sparql.test.ts}.
 *
 * @module
 */

import { DataFactory, Parser, Store } from "n3";
import type { BlankNode, NamedNode, Quad, Term } from "n3";
import { canonize } from "rdf-canonize";
import { getFormat } from "./rdf.ts";
import {
  resolveSkolemPrefix,
  skolemizeBlankNodeLabel,
  type SkolemOptions,
} from "./skolem.ts";

function isBlankNodeTerm(term: Term): term is BlankNode {
  return term.termType === "BlankNode";
}

function skolemNamedNode(term: BlankNode, opts?: SkolemOptions): NamedNode {
  const prefix = resolveSkolemPrefix(opts);
  const id = skolemizeBlankNodeLabel(`_:${term.value}`);
  return DataFactory.namedNode(`${prefix}${id}`);
}

/**
 * Replaces any blank nodes in the quad with skolem NamedNodes.
 * This makes the resulting store safer for pipelines that prefer stable IRIs.
 */
export function toSkolemizedQuad(quad: Quad, opts?: SkolemOptions): Quad {
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

/**
 * Parses RDF bytes into an N3 {@link Store}: parse → RDFC-1.0 whole-graph
 * canonicalize → skolemize blank nodes → store.
 *
 * @param data - UTF-8 RDF payload.
 * @param contentType - MIME type (e.g. `application/n-triples`); unknown values fall
 *   back via {@link getFormat}.
 * @param options - Optional {@link SkolemOptions} (e.g. `skolemPrefix`).
 */
export async function parseStoreFromRdfBytes(
  data: ArrayBuffer,
  contentType: string,
  options?: SkolemOptions,
): Promise<Store> {
  const text = new TextDecoder().decode(data);
  const { n3Format } = getFormat(contentType);
  const parser = new Parser({ format: n3Format });

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
