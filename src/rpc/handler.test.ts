import { assertEquals } from "@std/assert";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { Worlds } from "#/core/worlds.ts";
import { handleRpc } from "#/rpc/handler.ts";
import type { WorldsRpcRequest } from "#/rpc/openapi/generated/types.gen.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { IndexedQuadStorageManager } from "#/rdf/storage/indexed-quad-storage-manager.ts";

function createWorlds() {
  const chunkIndexManager = new InMemoryChunkIndexManager();
  const embeddings = new FakeEmbeddingsService();
  return new Worlds({
    worldStorage: new InMemoryWorldStorage(),
    quadStorageManager: new IndexedQuadStorageManager(
      embeddings,
      chunkIndexManager,
    ),
    chunkIndexManager,
    embeddings,
  });
}

Deno.test("handleRpc: createWorld then getWorld", async () => {
  const worlds = createWorlds();

  const createReq: WorldsRpcRequest = {
    action: "createWorld",
    request: { namespace: "ns", id: "w1", displayName: "World 1" },
  };
  const createRes = await handleRpc(worlds, createReq);
  assertEquals(createRes.action, "createWorld");
  if ("response" in createRes && createRes.action === "createWorld") {
    assertEquals(createRes.response.world.name, "ns/w1");
  }

  const getReq: WorldsRpcRequest = {
    action: "getWorld",
    request: { source: "ns/w1" },
  };
  const getRes = await handleRpc(worlds, getReq);
  assertEquals(getRes.action, "getWorld");
  if ("response" in getRes && getRes.action === "getWorld") {
    assertEquals(getRes.response.world?.name, "ns/w1");
  }
});

Deno.test("handleRpc: error envelope includes action", async () => {
  const worlds = createWorlds();
  const req: WorldsRpcRequest = {
    action: "updateWorld",
    request: { source: "ns/missing", displayName: "x" },
  };
  const res = await handleRpc(worlds, req);
  assertEquals(res.action, "updateWorld");
  if ("error" in res) {
    assertEquals(res.error.code, "NOT_FOUND");
  }
});

Deno.test("handleRpc: createWorld duplicate returns ALREADY_EXISTS", async () => {
  const worlds = createWorlds();
  const req: WorldsRpcRequest = {
    action: "createWorld",
    request: { namespace: "ns", id: "dup", displayName: "D" },
  };
  await handleRpc(worlds, req);
  const res = await handleRpc(worlds, req);
  assertEquals(res.action, "createWorld");
  if ("error" in res) {
    assertEquals(res.error.code, "ALREADY_EXISTS");
  }
});

Deno.test("handleRpc: deleteWorld", async () => {
  const worlds = createWorlds();
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "del" },
  } as WorldsRpcRequest);

  const res = await handleRpc(worlds, {
    action: "deleteWorld",
    request: { source: "ns/del" },
  } as WorldsRpcRequest);
  assertEquals(res.action, "deleteWorld");
  assertEquals("response" in res, true);

  const getRes = await handleRpc(worlds, {
    action: "getWorld",
    request: { source: "ns/del" },
  } as WorldsRpcRequest);
  if ("response" in getRes && getRes.action === "getWorld") {
    assertEquals(getRes.response.world, undefined);
  }
});

Deno.test("handleRpc: listWorlds", async () => {
  const worlds = createWorlds();
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "l1" },
  } as WorldsRpcRequest);
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "l2" },
  } as WorldsRpcRequest);

  const res = await handleRpc(worlds, {
    action: "listWorlds",
    request: {},
  } as WorldsRpcRequest);
  assertEquals(res.action, "listWorlds");
  if ("response" in res && res.action === "listWorlds") {
    assertEquals(res.response.worlds?.length, 2);
  }
});

Deno.test("handleRpc: listWorlds invalid pageToken returns INVALID_ARGUMENT", async () => {
  const worlds = createWorlds();
  const res = await handleRpc(worlds, {
    action: "listWorlds",
    request: { pageSize: 1, pageToken: "not-a-token" },
  } as WorldsRpcRequest);
  assertEquals(res.action, "listWorlds");
  if ("error" in res) {
    assertEquals(res.error.code, "INVALID_ARGUMENT");
  }
});

Deno.test("handleRpc: sparql unsupported query returns INVALID_ARGUMENT", async () => {
  const worlds = createWorlds();
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "spq" },
  } as WorldsRpcRequest);

  const res = await handleRpc(worlds, {
    action: "sparql",
    request: {
      sources: ["ns/spq"],
      query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    },
  } as WorldsRpcRequest);
  assertEquals(res.action, "sparql");
  if ("error" in res) {
    assertEquals(res.error.code, "INVALID_ARGUMENT");
  }
});

Deno.test("handleRpc: importWorld then sparql", async () => {
  const worlds = createWorlds();
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "imp" },
  } as WorldsRpcRequest);

  const importRes = await handleRpc(worlds, {
    action: "importWorld",
    request: {
      source: "ns/imp",
      data:
        `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
      contentType: "application/n-quads",
    },
  } as WorldsRpcRequest);
  assertEquals(importRes.action, "importWorld");
  assertEquals("response" in importRes, true);

  const sparqlRes = await handleRpc(worlds, {
    action: "sparql",
    request: {
      sources: ["ns/imp"],
      query:
        "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o }",
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
  const worlds = createWorlds();
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "srch" },
  } as WorldsRpcRequest);
  await handleRpc(worlds, {
    action: "importWorld",
    request: {
      source: "ns/srch",
      data: `<https://example.com/s> <https://example.com/p> "hello world" .`,
      contentType: "application/n-quads",
    },
  } as WorldsRpcRequest);

  const res = await handleRpc(worlds, {
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
  const worlds = createWorlds();
  await handleRpc(worlds, {
    action: "createWorld",
    request: { namespace: "ns", id: "exp" },
  } as WorldsRpcRequest);
  await handleRpc(worlds, {
    action: "importWorld",
    request: {
      source: "ns/exp",
      data:
        `<https://example.com/s> <https://example.com/p> <https://example.com/o> .`,
      contentType: "application/n-quads",
    },
  } as WorldsRpcRequest);

  const res = await handleRpc(worlds, {
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
