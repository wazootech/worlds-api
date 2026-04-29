import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/search/embeddings/fake.ts";
import { InMemoryChunkStorage } from "#/search/storage/in-memory.ts";
import { Worlds } from "#/core/worlds.ts";
import { handleRpc } from "#/api/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/api/openapi/generated/types.gen.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { IndexedFactStorageManager } from "#/facts/storage/indexed-fact-storage-manager.ts";

function createCore() {
  const chunkStorage = new InMemoryChunkStorage();
  const embeddings = new FakeEmbeddingsService();
  return new Worlds(
    new InMemoryWorldStorage(),
    new IndexedFactStorageManager(embeddings, chunkStorage),
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

Deno.test("handleRpc: createWorld duplicate returns ALREADY_EXISTS", async () => {
  const core = createCore();
  const req: WorldsRpcRequest = {
    action: "createWorld",
    request: { namespace: "ns", id: "dup", displayName: "D" },
  };
  await handleRpc(core, req);
  const res = await handleRpc(core, req);
  assertEquals(res.action, "createWorld");
  if ("error" in res) {
    assertEquals(res.error.code, "ALREADY_EXISTS");
  }
});

Deno.test("handleRpc: deleteWorld", async () => {
  const core = createCore();
  await handleRpc(core, {
    action: "createWorld",
    request: { namespace: "ns", id: "del" },
  } as WorldsRpcRequest);

  const res = await handleRpc(core, {
    action: "deleteWorld",
    request: { source: "ns/del" },
  } as WorldsRpcRequest);
  assertEquals(res.action, "deleteWorld");
  assertEquals("response" in res, true);

  const getRes = await handleRpc(core, {
    action: "getWorld",
    request: { source: "ns/del" },
  } as WorldsRpcRequest);
  if ("response" in getRes && getRes.action === "getWorld") {
    assertEquals(getRes.response.world, undefined);
  }
});

Deno.test("handleRpc: listWorlds", async () => {
  const core = createCore();
  await handleRpc(core, {
    action: "createWorld",
    request: { namespace: "ns", id: "l1" },
  } as WorldsRpcRequest);
  await handleRpc(core, {
    action: "createWorld",
    request: { namespace: "ns", id: "l2" },
  } as WorldsRpcRequest);

  const res = await handleRpc(core, {
    action: "listWorlds",
    request: {},
  } as WorldsRpcRequest);
  assertEquals(res.action, "listWorlds");
  if ("response" in res && res.action === "listWorlds") {
    assertEquals(res.response.worlds?.length, 2);
  }
});

Deno.test("handleRpc: importWorld then sparql", async () => {
  const core = createCore();
  await handleRpc(core, {
    action: "createWorld",
    request: { namespace: "ns", id: "imp" },
  } as WorldsRpcRequest);

  const importRes = await handleRpc(core, {
    action: "importWorld",
    request: {
      source: "ns/imp",
      data: `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
      contentType: "application/n-quads",
    },
  } as WorldsRpcRequest);
  assertEquals(importRes.action, "importWorld");
  assertEquals("response" in importRes, true);

  const sparqlRes = await handleRpc(core, {
    action: "sparql",
    request: {
      sources: ["ns/imp"],
      query: "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
    },
  } as WorldsRpcRequest);
  assertEquals(sparqlRes.action, "sparql");
  if ("response" in sparqlRes) {
    const data = sparqlRes.response as {
      results: { bindings: Array<{ o?: { value: string } }> };
    };
    assertEquals(data.results.bindings.length, 1);
  }
});

Deno.test("handleRpc: searchWorlds", async () => {
  const core = createCore();
  await handleRpc(core, {
    action: "createWorld",
    request: { namespace: "ns", id: "srch" },
  } as WorldsRpcRequest);
  await handleRpc(core, {
    action: "importWorld",
    request: {
      source: "ns/srch",
      data: `<https://example.com/s> <https://example.com/p> "hello world" .`,
      contentType: "application/n-quads",
    },
  } as WorldsRpcRequest);

  const res = await handleRpc(core, {
    action: "searchWorlds",
    request: { query: "hello", sources: ["ns/srch"] },
  } as WorldsRpcRequest);
  assertEquals(res.action, "searchWorlds");
  if ("response" in res && res.action === "searchWorlds") {
    const data = res.response as { results?: Array<{ object: string }> };
    assertEquals(data.results?.length, 1);
  }
});

Deno.test("handleRpc: exportWorld", async () => {
  const core = createCore();
  await handleRpc(core, {
    action: "createWorld",
    request: { namespace: "ns", id: "exp" },
  } as WorldsRpcRequest);
  await handleRpc(core, {
    action: "importWorld",
    request: {
      source: "ns/exp",
      data: `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
      contentType: "application/n-quads",
    },
  } as WorldsRpcRequest);

  const res = await handleRpc(core, {
    action: "exportWorld",
    request: { source: "ns/exp", contentType: "application/n-quads" },
  } as WorldsRpcRequest);
  assertEquals(res.action, "exportWorld");
  if ("response" in res && res.action === "exportWorld") {
    const data = res.response as { data: string; contentType: string };
    assertEquals(data.contentType, "application/n-quads");
    // data is base64 encoded
    assertEquals(typeof data.data, "string");
    assertEquals(data.data.length > 0, true);
  }
});
