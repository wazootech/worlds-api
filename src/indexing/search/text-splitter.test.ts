import { assertEquals } from "@std/assert";
import { splitTextRecursive } from "./text-splitter.ts";

Deno.test("splitTextRecursive: short text returns single chunk", () => {
  const result = splitTextRecursive("Hello world", 1000);
  assertEquals(result, ["Hello world"]);
});

Deno.test("splitTextRecursive: empty string returns empty array", () => {
  const result = splitTextRecursive("");
  assertEquals(result, []);
});

Deno.test("splitTextRecursive: whitespace-only returns empty array", () => {
  const result = splitTextRecursive("   ");
  assertEquals(result, []);
});

Deno.test("splitTextRecursive: splits on paragraph boundary", () => {
  const a = "A".repeat(80);
  const b = "B".repeat(80);
  const text = `${a}\n\n${b}`;
  const result = splitTextRecursive(text, 100, 20);
  assertEquals(result.length, 2);
  assertEquals(result[0], a);
  assertEquals(result[1], b);
});

Deno.test("splitTextRecursive: splits on newline when paragraphs too large", () => {
  const a = "A".repeat(80);
  const b = "B".repeat(80);
  const text = `${a}\n${b}`;
  const result = splitTextRecursive(text, 100, 20);
  assertEquals(result.length, 2);
  assertEquals(result[0], a);
  assertEquals(result[1], b);
});

Deno.test("splitTextRecursive: falls through to character splitting for long unbreakable text", () => {
  const text = "X".repeat(250);
  const result = splitTextRecursive(text, 100, 20);
  // Should produce 3+ chunks with overlap
  assertEquals(result.length >= 3, true);
  // Each chunk should be <= 100
  for (const chunk of result) {
    assertEquals(chunk.length <= 100, true);
  }
});

Deno.test("splitTextRecursive: text exactly at chunk size returns single chunk", () => {
  const text = "A".repeat(100);
  const result = splitTextRecursive(text, 100, 20);
  assertEquals(result, [text]);
});

Deno.test("splitTextRecursive: respects sentence separator", () => {
  const s1 = "A".repeat(60);
  const s2 = "B".repeat(60);
  const text = `${s1}. ${s2}`;
  const result = splitTextRecursive(text, 80, 10);
  assertEquals(result.length, 2);
  assertEquals(result[0], s1);
  assertEquals(result[1], s2);
});

Deno.test("splitTextRecursive: default chunk size handles realistic text", () => {
  const shortText = "The quick brown fox jumps over the lazy dog.";
  const result = splitTextRecursive(shortText);
  assertEquals(result, [shortText]);
});
