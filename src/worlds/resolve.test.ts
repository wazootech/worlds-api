import { assertEquals, assertThrows } from "@std/assert";
import {
  formatWorldName,
  parseWorldName,
  resolveWorldRefFromSource,
  WorldRefError,
} from "./resolve.ts";

Deno.test("formatWorldName: uses `${namespace}/${id}`", () => {
  assertEquals(formatWorldName({ namespace: "ns", id: "w1" }), "ns/w1");
});

Deno.test("parseWorldName: parses `{namespace}/{id}`", () => {
  assertEquals(parseWorldName("ns/w1"), { namespace: "ns", id: "w1" });
});

Deno.test("parseWorldName: rejects surrounding slashes", () => {
  assertThrows(
    () => parseWorldName("/ns/w1/"),
    WorldRefError,
    'Expected "{namespace}/{id}"',
  );
});

Deno.test("parseWorldName: rejects non 2-part names", () => {
  assertThrows(
    () => parseWorldName("ns/w1/extra"),
    WorldRefError,
    'Expected "{namespace}/{id}"',
  );
});

Deno.test("resolveWorldRefFromSource: string source is a name", () => {
  assertEquals(resolveWorldRefFromSource("ns/w1"), {
    namespace: "ns",
    id: "w1",
  });
});

Deno.test("resolveWorldRefFromSource: object source with name parses name", () => {
  assertEquals(resolveWorldRefFromSource({ name: "ns/w1" }), {
    namespace: "ns",
    id: "w1",
  });
});

Deno.test("resolveWorldRefFromSource: object source with namespace+id", () => {
  assertEquals(resolveWorldRefFromSource({ namespace: "ns", id: "w1" }), {
    namespace: "ns",
    id: "w1",
  });
});

Deno.test("resolveWorldRefFromSource: missing namespace fails", () => {
  assertThrows(
    () => resolveWorldRefFromSource({ id: "w1" }),
    WorldRefError,
    "namespace",
  );
});

Deno.test("resolveWorldRefFromSource: missing id fails", () => {
  assertThrows(
    () => resolveWorldRefFromSource({ namespace: "ns" }),
    WorldRefError,
    "id",
  );
});
