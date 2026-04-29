import { assertEquals } from "@std/assert";
import { ftsTermHits, tokenizeSearchQuery } from "./fts.ts";

// --- tokenizeSearchQuery ---

Deno.test("tokenizeSearchQuery: splits on whitespace and lowercases", () => {
  assertEquals(tokenizeSearchQuery("Hello World"), ["hello", "world"]);
});

Deno.test("tokenizeSearchQuery: handles multiple spaces and tabs", () => {
  assertEquals(tokenizeSearchQuery("  foo   bar\tbaz  "), [
    "foo",
    "bar",
    "baz",
  ]);
});

Deno.test("tokenizeSearchQuery: empty string returns empty array", () => {
  assertEquals(tokenizeSearchQuery(""), []);
});

Deno.test("tokenizeSearchQuery: whitespace-only returns empty array", () => {
  assertEquals(tokenizeSearchQuery("   "), []);
});

Deno.test("tokenizeSearchQuery: single word", () => {
  assertEquals(tokenizeSearchQuery("hello"), ["hello"]);
});

Deno.test("tokenizeSearchQuery: preserves special characters", () => {
  assertEquals(tokenizeSearchQuery("foo-bar baz_qux"), ["foo-bar", "baz_qux"]);
});

// --- ftsTermHits ---

Deno.test("ftsTermHits: term in subject scores 1", () => {
  const hits = ftsTermHits(
    ["alice"],
    "https://example.org/alice",
    "https://example.org/p",
    "some text",
  );
  assertEquals(hits, 1);
});

Deno.test("ftsTermHits: term in predicate scores 1", () => {
  const hits = ftsTermHits(
    ["name"],
    "https://example.org/s",
    "https://example.org/name",
    "some text",
  );
  assertEquals(hits, 1);
});

Deno.test("ftsTermHits: term in object scores 1", () => {
  const hits = ftsTermHits(
    ["hello"],
    "https://example.org/s",
    "https://example.org/p",
    "Hello World",
  );
  assertEquals(hits, 1);
});

Deno.test("ftsTermHits: each distinct term counted once even if in multiple fields", () => {
  // "alice" appears in both subject and object — should still be 1
  const hits = ftsTermHits(
    ["alice"],
    "https://example.org/alice",
    "https://example.org/p",
    "Alice is great",
  );
  assertEquals(hits, 1);
});

Deno.test("ftsTermHits: multiple terms all matching", () => {
  const hits = ftsTermHits(
    ["alice", "bob"],
    "https://example.org/alice",
    "https://example.org/p",
    "Bob is a friend",
  );
  assertEquals(hits, 2);
});

Deno.test("ftsTermHits: no matching terms returns 0", () => {
  const hits = ftsTermHits(
    ["xyz"],
    "https://example.org/s",
    "https://example.org/p",
    "hello",
  );
  assertEquals(hits, 0);
});

Deno.test("ftsTermHits: empty terms array returns 0", () => {
  const hits = ftsTermHits(
    [],
    "https://example.org/s",
    "https://example.org/p",
    "hello",
  );
  assertEquals(hits, 0);
});

Deno.test("ftsTermHits: case insensitive matching", () => {
  const hits = ftsTermHits(["alice"], "HTTPS://EXAMPLE.ORG/ALICE", "P", "O");
  assertEquals(hits, 1);
});
