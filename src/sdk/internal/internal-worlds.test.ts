import { assert, assertEquals } from "@std/assert";
import { InternalWorlds } from "./internal-worlds.ts";
import { createServer } from "#/server/server.ts";
import { createTestAccount, createTestContext } from "#/server/testing.ts";

Deno.test("InternalWorlds - Accounts", async (t) => {
  const appContext = await createTestContext();
  const server = await createServer(appContext);
  const sdk = new InternalWorlds({
    baseUrl: "http://localhost/v1",
    apiKey: appContext.admin!.apiKey, // Use admin API key for SDK
    fetch: (url, init) => server.fetch(new Request(url, init)),
  });

  await t.step("create account", async () => {
    const account = await sdk.accounts.create({
      id: "acc_sdk_test",
      description: "SDK Test Account",
      plan: "free",
    });
    assertEquals(account.id, "acc_sdk_test");
    assertEquals(account.description, "SDK Test Account");
    assertEquals(account.plan, "free");
  });

  await t.step("get account", async () => {
    const account = await sdk.accounts.get("acc_sdk_test");
    assert(account !== null);
    assertEquals(account.id, "acc_sdk_test");
    assertEquals(account.description, "SDK Test Account");
  });

  await t.step("list accounts", async () => {
    const accounts = await sdk.accounts.list();
    assert(accounts.length >= 1);
    const found = accounts.find((a) => a.id === "acc_sdk_test");
    assert(found !== undefined);
  });

  await t.step("update account", async () => {
    await sdk.accounts.update("acc_sdk_test", {
      description: "Updated SDK Account",
    });
    const account = await sdk.accounts.get("acc_sdk_test");
    assert(account !== null);
    assertEquals(account.description, "Updated SDK Account");
  });

  await t.step("rotate account key", async () => {
    const original = await sdk.accounts.get("acc_sdk_test");
    await sdk.accounts.rotate("acc_sdk_test");
    const rotated = await sdk.accounts.get("acc_sdk_test");
    assert(original && rotated);
    assert(original.apiKey !== rotated.apiKey);
  });

  await t.step("delete account", async () => {
    await sdk.accounts.delete("acc_sdk_test");
    const account = await sdk.accounts.get("acc_sdk_test");
    assertEquals(account, null);
  });

  appContext.kv.close();
});

Deno.test("InternalWorlds - Plans", async (t) => {
  const appContext = await createTestContext();
  const server = await createServer(appContext);
  const sdk = new InternalWorlds({
    baseUrl: "http://localhost/v1",
    apiKey: appContext.admin!.apiKey,
    fetch: (url, init) => server.fetch(new Request(url, init)),
  });

  await t.step("create plan", async () => {
    const plan = await sdk.plans.create({
      name: "sdk_plan",
      quotaRequestsPerMin: 100,
      quotaStorageBytes: 1000,
    });
    assertEquals(plan.name, "sdk_plan");
    assertEquals(plan.quotaRequestsPerMin, 100);
  });

  await t.step("get plan", async () => {
    const plan = await sdk.plans.get("sdk_plan");
    assert(plan !== null);
    assertEquals(plan.name, "sdk_plan");
  });

  await t.step("list plans", async () => {
    const plans = await sdk.plans.list();
    const found = plans.find((p) => p.name === "sdk_plan");
    assert(found !== undefined);
  });

  await t.step("update plan", async () => {
    await sdk.plans.update("sdk_plan", {
      name: "sdk_plan",
      quotaRequestsPerMin: 200,
      quotaStorageBytes: 2000,
    });
    const plan = await sdk.plans.get("sdk_plan");
    assert(plan !== null);
    assertEquals(plan.quotaRequestsPerMin, 200);
  });

  await t.step("delete plan", async () => {
    await sdk.plans.delete("sdk_plan");
    const plan = await sdk.plans.get("sdk_plan");
    assertEquals(plan, null);
  });

  appContext.kv.close();
});

Deno.test("InternalWorlds - Worlds", async (t) => {
  const appContext = await createTestContext();
  const server = await createServer(appContext);

  // We need a test account to create worlds
  // We need a test account to create worlds
  const { id: accountId, apiKey } = await createTestAccount(appContext.db);

  // Use the account's API key for world operations
  const sdk = new InternalWorlds({
    baseUrl: "http://localhost/v1",
    apiKey: apiKey,
    fetch: (url, init) => server.fetch(new Request(url, init)),
  });

  let worldId: string;

  await t.step("create world", async () => {
    const world = await sdk.worlds.create({
      accountId,
      name: "SDK World",
      description: "Test World",
      isPublic: false,
    });
    assert(world.id !== undefined);
    assertEquals(world.name, "SDK World");
    worldId = world.id;
  });

  await t.step("get world", async () => {
    const world = await sdk.worlds.get(worldId);
    assert(world !== null);
    assertEquals(world.name, "SDK World");
  });

  await t.step("list worlds", async () => {
    const worlds = await sdk.worlds.list();
    const found = worlds.find((w) => w.id === worldId);
    assert(found !== undefined);
  });

  await t.step("update world", async () => {
    await sdk.worlds.update(worldId, {
      description: "Updated Description",
    });
    const world = await sdk.worlds.get(worldId);
    assert(world !== null);
    assertEquals(world.description, "Updated Description");
  });

  await t.step("search world", async () => {
    // Mock search probably won't return anything meaningful without embeddings setup,
    // but we can check it doesn't crash
    const results = await sdk.worlds.search(worldId, "test");
    assert(Array.isArray(results));
  });

  await t.step("sparql update and query", async () => {
    // 1. Insert data via SPARQL Update
    const updateQuery = `
      INSERT DATA {
        <http://example.org/subject> <http://example.org/predicate> "Create Object" .
      }
    `;
    await sdk.worlds.sparqlUpdate(worldId, updateQuery);

    // 2. Query data via SPARQL Query
    const selectQuery = `
      SELECT ?s ?p ?o WHERE {
        ?s ?p ?o
      }
    `;

    const result = await sdk.worlds.sparqlQuery(
      worldId,
      selectQuery,
      // deno-lint-ignore no-explicit-any
    ) as any;
    assert(result.results.bindings.length > 0);

    const binding = result.results.bindings[0];
    assertEquals(binding.o.value, "Create Object");
  });

  await t.step("get usage", async () => {
    // Seed usage data
    const bucketId = "bucket_01";
    await appContext.db.usageBuckets.set(bucketId, {
      accountId,
      worldId,
      bucketStartTs: Date.now(),
      requestCount: 42,
    });

    const usage = await sdk.worlds.getUsage(worldId);
    assert(usage.length >= 1);
    const bucket = usage.find((u) => u.id === bucketId);
    assert(bucket !== undefined);
    assertEquals(bucket.requestCount, 42);
  });

  await t.step("delete world", async () => {
    await sdk.worlds.remove(worldId);
    const world = await sdk.worlds.get(worldId);
    assertEquals(world, null);
  });

  appContext.kv.close();
});
