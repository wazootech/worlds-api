import { assertEquals, assertThrows } from "@std/assert";
import {
  assertPageTokenSig,
  decodePageToken,
  encodePageToken,
  signPageTokenParams,
} from "./pagination.ts";

Deno.test("pagination: token roundtrip", async () => {
  const sig = await signPageTokenParams({ method: "listWorlds", parent: "ns" });
  const token = encodePageToken({ v: 1, o: 123, sig });
  const decoded = decodePageToken(token);
  assertEquals(decoded.v, 1);
  assertEquals(decoded.o, 123);
  assertEquals(decoded.sig, sig);
});

Deno.test("pagination: invalid token rejects", () => {
  assertThrows(
    () => decodePageToken("not-a-token"),
    Error,
    "Invalid page token",
  );
});

Deno.test("pagination: signature mismatch rejects", async () => {
  const sig1 = await signPageTokenParams({ method: "listWorlds", parent: "a" });
  const sig2 = await signPageTokenParams({ method: "listWorlds", parent: "b" });
  const token = encodePageToken({ v: 1, o: 0, sig: sig1 });
  const decoded = decodePageToken(token);
  assertThrows(
    () => assertPageTokenSig(decoded, sig2),
    Error,
    "Invalid page token",
  );
});
