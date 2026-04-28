import { assertEquals } from "@std/assert";
import { InMemoryWorldStorage } from "./in-memory.ts";
import type { StoredWorld } from "./types.ts";

const SAMPLE_WORLD: StoredWorld = {
  reference: { namespace: "ns", id: "w1" },
  displayName: "World 1",
  description: "A test world",
  createTime: 1000,
};

Deno.test("InMemoryWorldStorage: getWorld returns world", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld(SAMPLE_WORLD);

  const result = await storage.getWorld(SAMPLE_WORLD.reference);
  assertEquals(result?.reference.id, "w1");
  assertEquals(result?.reference.namespace, "ns");
});

Deno.test("InMemoryWorldStorage: getWorld returns null for missing", async () => {
  const storage = new InMemoryWorldStorage();

  const result = await storage.getWorld({ namespace: "ns", id: "missing" });
  assertEquals(result, null);
});

Deno.test("InMemoryWorldStorage: updateWorld creates new world", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld(SAMPLE_WORLD);

  const worlds = await storage.listWorld();
  assertEquals(worlds.length, 1);
  assertEquals(worlds[0].reference.id, "w1");
});

Deno.test("InMemoryWorldStorage: updateWorld updates existing world", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld(SAMPLE_WORLD);

  await storage.updateWorld({
    reference: SAMPLE_WORLD.reference,
    displayName: "Updated Name",
    createTime: 1000,
  });

  const result = await storage.getWorld(SAMPLE_WORLD.reference);
  assertEquals(result?.displayName, "Updated Name");
});

Deno.test("InMemoryWorldStorage: deleteWorld removes world", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld(SAMPLE_WORLD);

  await storage.deleteWorld(SAMPLE_WORLD.reference);

  const result = await storage.getWorld(SAMPLE_WORLD.reference);
  assertEquals(result, null);
});

Deno.test("InMemoryWorldStorage: deleteWorld is no-op for missing", async () => {
  const storage = new InMemoryWorldStorage();

  await storage.deleteWorld({ namespace: "ns", id: "missing" });

  const worlds = await storage.listWorld();
  assertEquals(worlds.length, 0);
});

Deno.test("InMemoryWorldStorage: listWorld returns all worlds", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld({
    reference: { namespace: "ns", id: "w1" },
    createTime: 1,
  });
  await storage.updateWorld({
    reference: { namespace: "ns", id: "w2" },
    createTime: 2,
  });
  await storage.updateWorld({
    reference: { namespace: "ns", id: "w3" },
    createTime: 3,
  });

  const worlds = await storage.listWorld();
  assertEquals(worlds.map((w) => w.reference.id).join(","), "w1,w2,w3");
});

Deno.test("InMemoryWorldStorage: listWorld filters by namespace", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld({
    reference: { namespace: "ns1", id: "w1" },
    createTime: 1,
  });
  await storage.updateWorld({
    reference: { namespace: "ns2", id: "w1" },
    createTime: 2,
  });

  const worlds = await storage.listWorld("ns1");
  assertEquals(worlds.length, 1);
  assertEquals(worlds[0].reference.namespace, "ns1");
});

Deno.test("InMemoryWorldStorage: listWorld returns empty for missing namespace", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld({
    reference: { namespace: "ns1", id: "w1" },
    createTime: 1,
  });

  const worlds = await storage.listWorld("missing");
  assertEquals(worlds.length, 0);
});

Deno.test("InMemoryWorldStorage: listWorld sorts by id deterministically", async () => {
  const storage = new InMemoryWorldStorage();
  await storage.updateWorld({
    reference: { namespace: "ns", id: "z" },
    createTime: 1,
  });
  await storage.updateWorld({
    reference: { namespace: "ns", id: "a" },
    createTime: 2,
  });
  await storage.updateWorld({
    reference: { namespace: "ns", id: "m" },
    createTime: 3,
  });

  const worlds = await storage.listWorld();
  assertEquals(worlds.map((w) => w.reference.id).join(","), "a,m,z");
});
