import type { StoredQuad } from "#/worlds/store/quad/types.ts";
import { DataFactory, Parser, Store, Writer } from "n3";

const df = DataFactory;

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
    const subject = q.subject.startsWith("_:")
      ? df.blankNode(q.subject.slice(2))
      : df.namedNode(q.subject);
    const predicate = df.namedNode(q.predicate);
    const object = q.object.startsWith("_:")
      ? df.blankNode(q.object.slice(2))
      : q.object.includes(":")
      ? df.namedNode(q.object)
      : df.literal(q.object);
    const graph = q.graph ? df.namedNode(q.graph) : df.defaultGraph();
    writer.addQuad(df.quad(subject, predicate, object, graph));
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
  const df = DataFactory;

  for (const q of quads) {
    const subject = q.subject.startsWith("_:")
      ? df.blankNode(q.subject.slice(2))
      : df.namedNode(q.subject);
    const predicate = df.namedNode(q.predicate);
    const object = q.object.startsWith("_:")
      ? df.blankNode(q.object.slice(2))
      : q.object.includes(":") || q.object.startsWith("urn:")
      ? df.namedNode(q.object)
      : df.literal(q.object);
    const graph = q.graph && q.graph !== ""
      ? df.namedNode(q.graph)
      : df.defaultGraph();

    store.addQuad(df.quad(subject, predicate, object, graph));
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
