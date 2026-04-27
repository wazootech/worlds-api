import { assertEquals, assertThrows } from "@std/assert";
import {
  formatWorldName,
  parseWorldName,
  resolveWorldReference,
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

Deno.test("resolveWorldReference: string source is a name", () => {
  assertEquals(resolveWorldReference("ns/w1"), {
    namespace: "ns",
    id: "w1",
  });
});

Deno.test("resolveWorldReference: object source with ref", () => {
  assertEquals(resolveWorldReference({ namespace: "ns", id: "w1" }), {
    namespace: "ns",
    id: "w1",
  });
});

Deno.test("resolveWorldReference: missing namespace fails", () => {
  assertThrows(
    () => resolveWorldReference({ namespace: "", id: "w1" }),
    WorldRefError,
    "namespace",
  );
});

Deno.test("resolveWorldReference: missing id fails", () => {
  assertThrows(
    () => resolveWorldReference({ namespace: "ns", id: "" }),
    WorldRefError,
    "id",
  );
});
