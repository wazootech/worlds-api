import { assertEquals } from "@std/assert";
import { WorldsCore } from "#/worlds/core.ts";
import { handleRpc } from "./handler.ts";
import type { WorldsRpcRequest } from "#/openapi/generated/types.gen.ts";
import { InMemoryWorldStorage } from "#/worlds/store/worlds/in-memory.ts";
import { InMemoryStoreStorage } from "#/worlds/store/store/in-memory.ts";

function createCore() {
  return new WorldsCore(
    new InMemoryWorldStorage(),
    new InMemoryStoreStorage(),
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
