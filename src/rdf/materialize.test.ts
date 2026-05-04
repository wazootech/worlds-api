import { assertEquals, assertStringIncludes } from "@std/assert";
import { DataFactory } from "n3";
import { parseStoreFromRdfBytes, toSkolemizedQuad } from "./materialize.ts";
import { resolveSkolemPrefix } from "./skolem.ts";

Deno.test("toSkolemizedQuad: keeps named nodes unchanged", () => {
  const s = DataFactory.namedNode("https://example.com/s");
  const p = DataFactory.namedNode("https://example.com/p");
  const o = DataFactory.namedNode("https://example.com/o");
  const q = DataFactory.quad(s, p, o);

  const out = toSkolemizedQuad(q);
  assertEquals(out.subject.termType, "NamedNode");
  assertEquals(out.subject.value, "https://example.com/s");
  assertEquals(out.predicate.value, "https://example.com/p");
  assertEquals(out.object.termType, "NamedNode");
  assertEquals(out.object.value, "https://example.com/o");
});

Deno.test("toSkolemizedQuad: skolemizes blank node subject/object with default prefix", () => {
  const s = DataFactory.blankNode("a");
  const p = DataFactory.namedNode("https://example.com/p");
  const o = DataFactory.blankNode("b");
  const q = DataFactory.quad(s, p, o);

  const out = toSkolemizedQuad(q);
  const prefix = resolveSkolemPrefix();
  assertEquals(out.subject.termType, "NamedNode");
  assertStringIncludes(out.subject.value, prefix);
  assertEquals(out.object.termType, "NamedNode");
  assertStringIncludes(out.object.value, prefix);
});

Deno.test("toSkolemizedQuad: skolem prefix is configurable", () => {
  const s = DataFactory.blankNode("a");
  const p = DataFactory.namedNode("https://example.com/p");
  const o = DataFactory.namedNode("https://example.com/o");
  const q = DataFactory.quad(s, p, o);

  const out = toSkolemizedQuad(q, { skolemPrefix: "urn:custom:" });
  assertEquals(out.subject.termType, "NamedNode");
  assertStringIncludes(out.subject.value, "urn:custom:");
});

Deno.test("parseStoreFromRdfBytes: parses N-Triples and skolemizes bnodes", async () => {
  const ntriples = "_:a <https://example.com/p> <https://example.com/o> .\n";
  const bytes = new TextEncoder().encode(ntriples).buffer;

  const store = await parseStoreFromRdfBytes(bytes, "application/n-triples");
  const stored = store.getQuads(null, null, null, null);
  assertEquals(stored.length, 1);
  assertEquals(stored[0].subject.termType, "NamedNode");
  assertStringIncludes(stored[0].subject.value, "urn:worlds:quad:");
});
