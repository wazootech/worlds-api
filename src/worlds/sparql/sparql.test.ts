import { assertEquals } from "@std/assert";
import type { Quad } from "n3";
import { DataFactory, Parser, Store } from "n3";
import { canonize } from "rdf-canonize";
import { encodeBase64Url } from "@std/encoding/base64url";
import type { SparqlSelectResults } from "#/openapi/generated/types.gen.ts";
import { executeSparql } from "./sparql.ts";

Deno.test("Comunica QueryEngine can query an n3 Store (RDFJS)", async () => {
  const store = new Store();
  store.addQuad(
    DataFactory.namedNode("https://example.com/s"),
    DataFactory.namedNode("https://example.com/p"),
    DataFactory.namedNode("https://example.com/o1"),
  );
  store.addQuad(
    DataFactory.namedNode("https://example.com/s"),
    DataFactory.namedNode("https://example.com/p"),
    DataFactory.namedNode("https://example.com/o2"),
  );

  const result = await executeSparql(
    store,
    "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
  );

  const rows = (result as SparqlSelectResults).results.bindings.map((b) =>
    (b as { o?: { value?: string } }).o?.value
  );

  assertEquals(rows, [
    "https://example.com/o1",
    "https://example.com/o2",
  ]);
});

Deno.test("Same SPARQL query works on bnodes vs processed (canonicalized + subject-skolemized) dataset", async (t) => {
  const ex = "https://example.com/";
  const pName = DataFactory.namedNode(`${ex}name`);
  const pKnows = DataFactory.namedNode(`${ex}knows`);

  // Dataset includes blank nodes as subjects. We'll run the same query before and after
  // processing the dataset with canonicalization + subject skolemization.
  const a = DataFactory.blankNode("a");
  const c = DataFactory.blankNode("c");
  const charlie = DataFactory.namedNode(`${ex}charlie`);
  const bob = DataFactory.namedNode(`${ex}bob`);

  const quads: Quad[] = [
    DataFactory.quad(a, pName, DataFactory.literal("Alice")),
    DataFactory.quad(c, pName, DataFactory.literal("Charlie")),
    DataFactory.quad(bob, pName, DataFactory.literal("Bob")),
    DataFactory.quad(charlie, pName, DataFactory.literal("Charlie")),
    DataFactory.quad(a, pKnows, bob),
    DataFactory.quad(c, pKnows, bob),
  ];

  const query = [
    "PREFIX ex: <https://example.com/>",
    "SELECT ?kind ?value WHERE {",
    "  {",
    "    ?s ex:name ?value .",
    '    BIND("name" AS ?kind)',
    "  } UNION {",
    "    ?s ex:knows ?value .",
    '    BIND("knows" AS ?kind)',
    "  }",
    "} ORDER BY ?kind ?value",
  ].join("\n");

  let bnodeRows: Array<Record<string, string>> = [];

  await t.step("query raw dataset with blank nodes", async () => {
    const original = new Store(quads);
    const result = await executeSparql(original, query);
    const bindings = (result as SparqlSelectResults).results.bindings as Array<
      Record<string, { type: string; value: string }>
    >;
    bnodeRows = bindings.map((b) => ({
      kind: b.kind?.value,
      value: b.value?.value,
    }));
    assertEquals(bnodeRows.length > 0, true);
  });

  await t.step(
    "process dataset (RDFC-1.0 canonicalization + subject skolemization) and rerun same query",
    async () => {
      const canonicalNQuads = await canonize(quads, {
        algorithm: "RDFC-1.0",
        format: "application/n-quads",
      });

      const canonicalStatements = canonicalNQuads
        .split("\n")
        .filter((l: string) => l.trim().length > 0)
        .map((l: string) => `${l}\n`);

      const parser = new Parser({ format: "application/n-quads" });
      const processed = new Store();

      for (const statement of canonicalStatements) {
        const [q] = parser.parse(statement) as Quad[];
        if (!q) continue;

        // Blank node subject skolemization:
        // input subject = "_:a" becomes NamedNode("urn:worlds:fact:" + base64url(RDFC-1.0(canonicalQuad))).
        const subject = q.subject.termType === "BlankNode"
          ? DataFactory.namedNode(
            `urn:worlds:fact:${
              encodeBase64Url(new TextEncoder().encode(statement))
            }`,
          )
          : q.subject;

        processed.addQuad(
          DataFactory.quad(subject, q.predicate, q.object, q.graph),
        );
      }

      const result = await executeSparql(processed, query);
      const bindings = (result as SparqlSelectResults).results
        .bindings as Array<
          Record<string, { type: string; value: string }>
        >;
      const processedRows = bindings.map((b) => ({
        kind: b.kind?.value,
        value: b.value?.value,
      }));

      assertEquals(processedRows, bnodeRows);
    },
  );
});
