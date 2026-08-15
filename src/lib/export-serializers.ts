import { Writer } from "n3";
import type * as rdfjs from "@rdfjs/types";

/**
 * Serializes quads to TriG via N3's Writer.
 *
 * TriG preserves named graphs: each graph becomes a named graph block, and
 * default-graph quads are emitted as top-level triples. Because the API has no
 * prefix mapping, output uses fully-qualified IRIs.
 */
export function serializeQuadsToTrig(quads: rdfjs.Quad[]): Promise<string> {
  const writer = new Writer({ format: "TriG" });
  for (const quad of quads) {
    writer.addQuad(quad);
  }
  return new Promise((resolve, reject) => {
    writer.end((error: Error | null, result?: string) => {
      if (error) reject(error);
      else resolve(result ?? "");
    });
  });
}

interface JsonLdGraph {
  "@id"?: string;
  "@graph"?: JsonLdNode[];
}

interface JsonLdNode {
  "@id": string;
  [predicate: string]: unknown;
}

interface JsonLdValue {
  "@id"?: string;
  "@value"?: string;
  "@type"?: string;
  "@language"?: string;
}

function isNamedGraph(graph: rdfjs.Term): boolean {
  return graph.termType !== "DefaultGraph";
}

function valueToJsonLd(term: rdfjs.Term): JsonLdValue {
  if (term.termType === "NamedNode" || term.termType === "BlankNode") {
    return { "@id": term.value };
  }
  if (term.termType === "Literal") {
    const value: JsonLdValue = { "@value": term.value };
    if (term.language) {
      value["@language"] = term.language;
    } else if (
      term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
    ) {
      value["@type"] = term.datatype.value;
    }
    return value;
  }
  return { "@value": term.value };
}

/**
 * Serializes quads to expanded-form JSON-LD.
 *
 * Each RDF/JS quad maps to a node in the `@graph` array. Predicate IRIs are
 * used directly as property keys and object terms are emitted as `@id`,
 * `@value`/`@type`, or `@value`/`@language` values. Named graphs are wrapped
 * in `{ "@id": <graph>, "@graph": [...] }` objects so graph membership is
 * preserved. The output round-trips through any JSON-LD 1.1 processor.
 */
export function serializeQuadsToJsonLd(quads: rdfjs.Quad[]): string {
  const graphs = new Map<string, rdfjs.Quad[]>();

  for (const quad of quads) {
    const graphKey = isNamedGraph(quad.graph) ? quad.graph.value : "";
    const bucket = graphs.get(graphKey) ?? [];
    bucket.push(quad);
    graphs.set(graphKey, bucket);
  }

  const graphEntries: JsonLdGraph[] = [];

  for (const [graphKey, graphQuads] of graphs) {
    const nodes = new Map<string, JsonLdNode>();

    for (const quad of graphQuads) {
      const subjectKey = quad.subject.value;
      const node = nodes.get(subjectKey) ?? { "@id": subjectKey };
      nodes.set(subjectKey, node);

      const predicate = quad.predicate.value;
      const value = valueToJsonLd(quad.object);

      if (!(predicate in node)) {
        node[predicate] = [value];
      } else {
        const values = node[predicate] as JsonLdValue[];
        values.push(value);
      }
    }

    const graphEntry: JsonLdGraph = { "@graph": Array.from(nodes.values()) };
    if (graphKey) {
      graphEntry["@id"] = graphKey;
    }
    graphEntries.push(graphEntry);
  }

  return JSON.stringify({ "@context": {}, "@graph": graphEntries }, null, 2);
}
