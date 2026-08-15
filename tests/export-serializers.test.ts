import { describe, expect, it } from "vitest";
import { DataFactory } from "n3";
import type * as rdfjs from "@rdfjs/types";
import {
  serializeQuadsToJsonLd,
  serializeQuadsToTrig,
} from "../src/lib/export-serializers";

const { namedNode, literal, quad, defaultGraph } = DataFactory;

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
  it("emits default-graph quads as triples and named-graph quads in named blocks", async () => {
    const trig = await serializeQuadsToTrig(sampleQuads());
    expect(trig).toContain("<urn:subject:alice>");
    expect(trig).toContain("<urn:predicate:name>");
    expect(trig).toContain('"Alice"');
    expect(trig).toContain("<urn:predicate:age>");
    expect(trig).toContain("urn:graph:private");
    expect(trig).toContain('"A note"');
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
