import { describe, expect, it } from "vitest";
import type * as rdfjs from "@rdfjs/types";
import {
  serializeQuadsToJsonLd,
  serializeQuadsToTrig,
} from "../src/lib/export-serializers";

// Simple DataFactory for tests
function namedNode(value: string): rdfjs.NamedNode {
  return { termType: "NamedNode", value } as rdfjs.NamedNode;
}

function literal(
  value: string,
  languageOrDatatype?: string | rdfjs.NamedNode,
): rdfjs.Literal {
  if (typeof languageOrDatatype === "string") {
    return {
      termType: "Literal",
      value,
      language: languageOrDatatype,
      datatype: namedNode(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
      ),
      direction: undefined,
    } as rdfjs.Literal;
  }
  return {
    termType: "Literal",
    value,
    language: "",
    datatype:
      languageOrDatatype ??
      namedNode("http://www.w3.org/2001/XMLSchema#string"),
    direction: undefined,
  } as rdfjs.Literal;
}

function quad(
  subject: rdfjs.Term,
  predicate: rdfjs.Term,
  object: rdfjs.Term,
  graph?: rdfjs.Term,
): rdfjs.Quad {
  return {
    termType: "Quad",
    value: "",
    subject,
    predicate,
    object,
    graph: graph ?? defaultGraph(),
  } as rdfjs.Quad;
}

function defaultGraph(): rdfjs.DefaultGraph {
  return { termType: "DefaultGraph", value: "" } as rdfjs.DefaultGraph;
}

function sampleQuads(): rdfjs.Quad[] {
  return [
    quad(
      namedNode("urn:subject:alice"),
      namedNode("urn:predicate:name"),
      literal("Alice"),
      defaultGraph(),
    ),
    quad(
      namedNode("urn:subject:alice"),
      namedNode("urn:predicate:knows"),
      namedNode("urn:subject:bob"),
      defaultGraph(),
    ),
    quad(
      namedNode("urn:subject:alice"),
      namedNode("urn:predicate:age"),
      literal("30", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      defaultGraph(),
    ),
    quad(
      namedNode("urn:subject:bob"),
      namedNode("urn:predicate:greeting"),
      literal("Hola", "es"),
      defaultGraph(),
    ),
    quad(
      namedNode("urn:subject:alice"),
      namedNode("urn:predicate:note"),
      literal("A note"),
      namedNode("urn:graph:private"),
    ),
  ];
}

describe("serializeQuadsToTrig", () => {
  it("emits default-graph quads as triples and named-graph quads in named blocks", () => {
    const trig = serializeQuadsToTrig(sampleQuads());
    expect(trig).toContain("<urn:subject:alice>");
    expect(trig).toContain("<urn:predicate:name>");
    expect(trig).toContain('"Alice"');
    expect(trig).toContain("<urn:predicate:age>");
    expect(trig).toContain("urn:graph:private");
    expect(trig).toContain('"A note"');
  });

  it("round-trips through the sparql-engine parser", async () => {
    const { parseTurtleQuads } = await import("@wazoo/sparql-engine");
    const quads = sampleQuads();
    const trig = serializeQuadsToTrig(quads);
    const parsed = Array.from(await parseTurtleQuads(trig, { format: "trig" }));

    // Should have same number of quads
    expect(parsed.length).toBe(quads.length);

    // Check that all original quads are present
    for (const original of quads) {
      const found = parsed.some(
        (p) =>
          p.subject.value === original.subject.value &&
          p.predicate.value === original.predicate.value &&
          p.object.value === original.object.value &&
          p.graph.value === original.graph.value,
      );
      expect(found).toBe(true);
    }
  });
});

describe("serializeQuadsToJsonLd", () => {
  it("produces parseable JSON-LD with graph, predicates, and literal values", () => {
    const jsonLd = JSON.parse(serializeQuadsToJsonLd(sampleQuads())) as {
      "@context": Record<string, unknown>;
      "@graph": Array<{
        "@id"?: string;
        "@graph"?: Array<Record<string, unknown>>;
      }>;
    };
    expect(jsonLd["@context"]).toEqual({});

    const defaultGraphEntry = jsonLd["@graph"].find(
      (entry) => entry["@id"] === undefined,
    );
    expect(defaultGraphEntry).toBeDefined();
    const aliceNode = defaultGraphEntry?.["@graph"]?.find(
      (node) => node["@id"] === "urn:subject:alice",
    );
    expect(aliceNode).toBeDefined();
    expect(aliceNode?.["urn:predicate:name"]).toEqual([{ "@value": "Alice" }]);
    expect(aliceNode?.["urn:predicate:knows"]).toEqual([
      { "@id": "urn:subject:bob" },
    ]);
    expect(aliceNode?.["urn:predicate:age"]).toEqual([
      {
        "@value": "30",
        "@type": "http://www.w3.org/2001/XMLSchema#integer",
      },
    ]);

    const namedGraphEntry = jsonLd["@graph"].find(
      (entry) => entry["@id"] === "urn:graph:private",
    );
    expect(namedGraphEntry).toBeDefined();
    const privateAlice = namedGraphEntry?.["@graph"]?.find(
      (node) => node["@id"] === "urn:subject:alice",
    );
    expect(privateAlice?.["urn:predicate:note"]).toEqual([
      { "@value": "A note" },
    ]);
  });

  it("preserves language tags on literals", () => {
    const quads = [
      quad(
        namedNode("urn:s"),
        namedNode("urn:p"),
        literal("Hola", "es"),
        defaultGraph(),
      ),
    ];
    const jsonLd = JSON.parse(serializeQuadsToJsonLd(quads)) as {
      "@graph": Array<{ "@graph": Array<Record<string, unknown>> }>;
    };
    const node = jsonLd["@graph"][0]["@graph"][0];
    expect(node["urn:p"]).toEqual([{ "@value": "Hola", "@language": "es" }]);
  });
});
