import { assertEquals } from "@std/assert";
import { deserialize, getFormat, serialize } from "#/worlds/rdf/rdf.ts";

Deno.test("serializes and deserializes turtle", () => {
  const input =
    `<http://example.org/subject> <http://example.org/predicate> "object" .
`;
  const quads = deserialize(input, "text/turtle");

  console.log("Parsed quads:", JSON.stringify(quads, null, 2));
});

Deno.test("round-trips n-quads", async () => {
  const input =
    `<http://example.org/s> <http://example.org/p> "o" <http://example.org/g> .
`;
  const quads = deserialize(input, "application/n-quads");
  const output = await serialize(quads, "application/n-quads");

  console.log("Input:", input);
  console.log("Output:", output);
  console.log("Quads:", JSON.stringify(quads, null, 2));

  assertEquals(quads.length, 1);
  assertEquals(quads[0].subject, "http://example.org/s");
  assertEquals(quads[0].predicate, "http://example.org/p");
  assertEquals(quads[0].object, "o");
  assertEquals(quads[0].graph, "http://example.org/g");
});

Deno.test("preserves URL-shaped literals as literals", async () => {
  const input =
    `<http://example.org/s> <http://example.org/p> "https://example.org/not-a-node" .\n`;
  const quads = deserialize(input, "application/n-quads");
  const output = await serialize(quads, "application/n-quads");

  assertEquals(quads[0].object, "https://example.org/not-a-node");
  assertEquals(quads[0].objectTermType, "Literal");
  assertEquals(
    output,
    `<http://example.org/s> <http://example.org/p> "https://example.org/not-a-node" .\n`,
  );
});

Deno.test("preserves literal datatype and language", async () => {
  const input =
    `<http://example.org/s> <http://example.org/when> "2026-04-27T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n` +
    `<http://example.org/s> <http://example.org/label> "bonjour"@fr .\n`;
  const quads = deserialize(input, "application/n-quads");
  const output = await serialize(quads, "application/n-quads");

  assertEquals(quads[0].objectTermType, "Literal");
  assertEquals(
    quads[0].objectDatatype,
    "http://www.w3.org/2001/XMLSchema#dateTime",
  );
  assertEquals(quads[1].objectLanguage, "fr");
  assertEquals(output, input);
});

Deno.test("getFormat defaults to n-quads", () => {
  const format = getFormat(undefined);
  assertEquals(format.contentType, "application/n-quads");
});
