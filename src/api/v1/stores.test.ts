import { assertEquals } from "@std/assert/equals";
import { toArrayBuffer } from "@std/streams";
import { OpenAPIHono } from "@hono/zod-openapi";
import { namedNode, quad, Store } from "oxigraph";
import type { EncodableEncoding } from "#/oxigraph/oxigraph-encoding.ts";
import {
  encodableEncodings,
  encodeStore,
} from "#/oxigraph/oxigraph-encoding.ts";
import { DenoKvOxigraphService } from "#/oxigraph/deno-kv-oxigraph-service.ts";
import { app as storeApp, withOxigraphService } from "./stores.ts";

// Encode a fake store.
const store = new Store([
  quad(
    namedNode("http://example.com/subject"),
    namedNode("http://example.com/predicate"),
    namedNode("http://example.com/object"),
  ),
]);

// Helper to get encoded bytes
async function getEncodedBytes(encoding: EncodableEncoding) {
  const stream = encodeStore(store, encoding);
  return new Uint8Array(await toArrayBuffer(stream));
}

// Use in-memory kv for testing.
const kv = await Deno.openKv(":memory:");
const oxigraphService = new DenoKvOxigraphService(kv);

const app = new OpenAPIHono();
app.use(withOxigraphService(oxigraphService));

// Mount the store app.
app.route("", storeApp);

Deno.test("e2e v1 stores API", async (t) => {
  const encodedBytes = await getEncodedBytes(encodableEncodings.nq);

  // Set the store.
  await t.step("PUT /v1/stores/{store}", async () => {
    const response = await app.request("/v1/stores/test-store", {
      method: "PUT",
      body: encodedBytes,
      headers: {
        "Content-Type": encodableEncodings.nq,
      },
    });
    assertEquals(response.status, 204);
  });

  // Get the store.
  await t.step("GET /v1/stores/{store}", async () => {
    const response = await app.request("/v1/stores/test-store", {
      method: "GET",
      headers: {
        "Accept": encodableEncodings.nq,
      },
    });
    assertEquals(response.status, 200);

    const body = await response.bytes();
    assertEquals(body, encodedBytes);
  });

  // Delete the store.
  await t.step("DELETE /v1/stores/{store}", async () => {
    const response = await app.request("/v1/stores/test-store", {
      method: "DELETE",
    });
    assertEquals(response.status, 204);
  });
});
