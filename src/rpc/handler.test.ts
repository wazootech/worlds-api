import { assertEquals } from "@std/assert";
import { InMemoryChunkStorage } from "#/infrastructure/chunks/in-memory.ts";
import { PlaceholderEmbeddingsService } from "#/infrastructure/embeddings/placeholder.ts";
import { WorldsCore } from "#/worlds/core.ts";
import { handleRpc } from "#/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/openapi/generated/types.gen.ts";
import { InMemoryWorldStorage } from "#/worlds/store/worlds/in-memory.ts";
import { IndexedStoreStorage } from "#/worlds/store/store/indexed-store-storage.ts";

function createCore() {
  const chunkStorage = new InMemoryChunkStorage();
  const embeddings = new PlaceholderEmbeddingsService();
  return new WorldsCore(
    new InMemoryWorldStorage(),
    new IndexedStoreStorage(embeddings, chunkStorage),
    { chunkStorage, embeddings },
  );
}

Deno.test("handleRpc: createWorld then getWorld", async () => {
  const core = createCore();

  const createReq: WorldsRpcRequest = {
    action: "createWorld",
    request: { namespace: "ns", id: "w1", displayName: "World 1" },
  };
  const createRes = await handleRpc(core, createReq);
  assertEquals(createRes.action, "createWorld");
  if ("response" in createRes && createRes.action === "createWorld") {
    assertEquals(createRes.response.world.name, "ns/w1");
  }

  const getReq: WorldsRpcRequest = {
    action: "getWorld",
    request: { source: "ns/w1" },
  };
  const getRes = await handleRpc(core, getReq);
  assertEquals(getRes.action, "getWorld");
  if ("response" in getRes && getRes.action === "getWorld") {
    assertEquals(getRes.response.world?.name, "ns/w1");
  }
});

Deno.test("handleRpc: error envelope includes action", async () => {
  const core = createCore();
  const req: WorldsRpcRequest = {
    action: "updateWorld",
    request: { source: "ns/missing", displayName: "x" },
  };
  const res = await handleRpc(core, req);
  assertEquals(res.action, "updateWorld");
  if ("error" in res) {
    assertEquals(res.error.code, "NOT_FOUND");
  }
});
