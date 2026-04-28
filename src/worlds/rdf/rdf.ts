import type { StoredQuad } from "#/worlds/store/quad/types.ts";
import type { Quad } from "n3";
import { DataFactory, Parser, Store, Writer } from "n3";

const df = DataFactory;

/**
 * Single source of truth: {@link StoredQuad} to N3 term/quad (aligns SPARQL, serialize, skolem ids).
 */
export function storedQuadToN3(quad: StoredQuad): Quad {
  const subject = quad.subject.startsWith("_:")
    ? df.blankNode(quad.subject.slice(2))
    : df.namedNode(quad.subject);
  const predicate = df.namedNode(quad.predicate);
  const object = quad.object.startsWith("_:")
    ? df.blankNode(quad.object.slice(2))
    : quad.object.includes(":") || quad.object.startsWith("urn:")
    ? df.namedNode(quad.object)
    : df.literal(quad.object);
  const graph = quad.graph && quad.graph !== ""
    ? df.namedNode(quad.graph)
    : df.defaultGraph();
  return df.quad(subject, predicate, object, graph);
}

export interface RdfFormat {
  contentType: string;
  n3Format: string;
}

export const FORMATS: Record<string, RdfFormat> = {
  "text/turtle": { contentType: "text/turtle", n3Format: "Turtle" },
  "application/n-quads": {
    contentType: "application/n-quads",
    n3Format: "N-Quads",
  },
  "application/n-triples": {
    contentType: "application/n-triples",
    n3Format: "N-Triples",
  },
  "text/n3": { contentType: "text/n3", n3Format: "N3" },
};

export function getFormat(contentType: string | undefined): RdfFormat {
  const format = contentType?.toLowerCase() || "application/n-quads";
  return FORMATS[format] || FORMATS["application/n-quads"];
}

export async function serialize(
  quads: StoredQuad[],
  contentType: string,
): Promise<string> {
  const { n3Format } = getFormat(contentType);
  const writer = new Writer({ format: n3Format });
  for (const q of quads) {
    writer.addQuad(storedQuadToN3(q));
  }
  const result = await new Promise<string>((resolve, reject) => {
    writer.end((err: Error | null, result?: string) => {
      if (err) reject(err);
      else resolve(result ?? "");
    });
  });
  return result;
}

export function deserialize(data: string, contentType: string): StoredQuad[] {
  const { n3Format } = getFormat(contentType);
  const parser = new Parser({ format: n3Format });
  const n3Quads = parser.parse(data);
  return n3Quads.map((q: {
    subject: { value: string; termType: string };
    predicate: { value: string };
    object: {
      value: string;
      termType: string;
      language?: string;
      datatype?: { value: string };
    };
    graph: { value: string; termType: string };
  }) => ({
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    graph: q.graph.termType === "DefaultGraph" ? "" : q.graph.value,
  }));
}

export function storeFromQuads(quads: StoredQuad[]): Store {
  const store = new Store();
  for (const q of quads) {
    store.addQuad(storedQuadToN3(q));
  }
  return store;
}

export function quadsFromStore(store: Store): StoredQuad[] {
  const quads: StoredQuad[] = [];

  for (const q of store.getQuads(null, null, null, null)) {
    quads.push({
      subject: q.subject.termType === "BlankNode"
        ? `_:${q.subject.value}`
        : q.subject.value,
      predicate: q.predicate.value,
      object: q.object.termType === "BlankNode"
        ? `_:${q.object.value}`
        : q.object.termType === "Literal"
        ? q.object.value
        : q.object.value,
      graph: q.graph.termType === "DefaultGraph" ? "" : q.graph.value,
    });
  }

  return quads;
}
