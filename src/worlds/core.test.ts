import { assertEquals, assertRejects } from "@std/assert";
import { WorldsCore } from "./core.ts";
import { InMemoryMetadataStorage } from "./store/worlds/in-memory.ts";
import { InMemoryStoreStorage } from "./store/store/in-memory.ts";

function createCore() {
  return new WorldsCore(
    new InMemoryMetadataStorage(),
    new InMemoryStoreStorage(),
  );
}

Deno.test("WorldsCore: create/get/update/delete world", async () => {
  const core = createCore();

  const created = await core.createWorld({
    namespace: "ns",
    id: "w1",
    displayName: "World 1",
    description: "desc",
  });
  assertEquals(created.name, "ns/w1");
  assertEquals(created.namespace, "ns");
  assertEquals(created.id, "w1");
  assertEquals(created.displayName, "World 1");

  const fetched = await core.getWorld({ source: "ns/w1" });
  assertEquals(fetched?.name, "ns/w1");

  const updated = await core.updateWorld({
    source: { namespace: "ns", id: "w1" },
    displayName: "World One",
  });
  assertEquals(updated.displayName, "World One");
  assertEquals(updated.description, "desc");

  await core.deleteWorld({ source: "ns/w1" });
  const afterDelete = await core.getWorld({ source: "ns/w1" });
  assertEquals(afterDelete, null);
});

Deno.test("WorldsCore: createWorld rejects duplicates", async () => {
  const core = createCore();
  await core.createWorld({ namespace: "ns", id: "w1" });
  await assertRejects(
    () => core.createWorld({ namespace: "ns", id: "w1" }),
    Error,
    "World already exists",
  );
});
