import type { StoredFact } from "#/worlds/rdf/facts/types.ts";
import type { Quad } from "n3";
import { DataFactory, Parser, Store, Writer } from "n3";

const df = DataFactory;
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/**
 * Single source of truth: {@link StoredFact} to N3 term/quad.
 */
export function storedFactToN3(fact: StoredFact): Quad {
  const subject = fact.subject.startsWith("_:")
    ? df.blankNode(fact.subject.slice(2))
    : df.namedNode(fact.subject);
  const predicate = df.namedNode(fact.predicate);
  const objectTermType = fact.objectTermType ??
    (fact.object.startsWith("_:")
      ? "BlankNode"
      : fact.object.includes(":") || fact.object.startsWith("urn:")
      ? "NamedNode"
      : "Literal");
  const object = objectTermType === "BlankNode"
    ? df.blankNode(
      fact.object.startsWith("_:") ? fact.object.slice(2) : fact.object,
    )
    : objectTermType === "NamedNode"
    ? df.namedNode(fact.object)
    : fact.objectLanguage
    ? df.literal(fact.object, fact.objectLanguage)
    : fact.objectDatatype && fact.objectDatatype !== XSD_STRING
    ? df.literal(fact.object, df.namedNode(fact.objectDatatype))
    : df.literal(fact.object);
  const graph = fact.graph && fact.graph !== ""
    ? df.namedNode(fact.graph)
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
  facts: StoredFact[],
  contentType: string,
): Promise<string> {
  const { n3Format } = getFormat(contentType);
  const writer = new Writer({ format: n3Format });
  for (const q of facts) {
    writer.addQuad(storedFactToN3(q));
  }
  const result = await new Promise<string>((resolve, reject) => {
    writer.end((err: Error | null, result?: string) => {
      if (err) reject(err);
      else resolve(result ?? "");
    });
  });
  return result;
}

export function deserialize(data: string, contentType: string): StoredFact[] {
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
    subject: q.subject.termType === "BlankNode"
      ? `_:${q.subject.value}`
      : q.subject.value,
    predicate: q.predicate.value,
    object: q.object.termType === "BlankNode"
      ? `_:${q.object.value}`
      : q.object.value,
    graph: q.graph.termType === "DefaultGraph" ? "" : q.graph.value,
    objectTermType: q.object.termType,
    objectDatatype: q.object.termType === "Literal"
      ? q.object.datatype?.value
      : undefined,
    objectLanguage: q.object.termType === "Literal"
      ? q.object.language || undefined
      : undefined,
  }));
}

export function storeFromFacts(facts: StoredFact[]): Store {
  const store = new Store();
  for (const q of facts) {
    store.addQuad(storedFactToN3(q));
  }
  return store;
}

export function factsFromStore(store: Store): StoredFact[] {
  const facts: StoredFact[] = [];

  for (const q of store.getQuads(null, null, null, null)) {
    facts.push({
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
      objectTermType: q.object.termType,
      objectDatatype: q.object.termType === "Literal"
        ? q.object.datatype.value
        : undefined,
      objectLanguage: q.object.termType === "Literal"
        ? q.object.language || undefined
        : undefined,
    });
  }

  return facts;
}
