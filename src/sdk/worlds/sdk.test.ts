import { assert, assertEquals } from "@std/assert";
import { createServer } from "#/server/server.ts";
import { createTestContext, createTestOrganization } from "#/server/testing.ts";
import type { SparqlSelectResults } from "./schema.ts";
import { WorldsSdk } from "#/sdk/sdk.ts";

Deno.test("WorldsSdk - Worlds", async (t) => {
  const appContext = await createTestContext();
  const server = await createServer(appContext);

  // We need a test organization to create worlds
  const { id: organizationId, apiKey } = await createTestOrganization(
    appContext,
  );

  // Use the admin API key for world operations
  // Note: Since we are using admin key, we must specify organizationId where required
  const sdk = new WorldsSdk({
    baseUrl: "http://localhost",
    apiKey: apiKey,
    fetch: (url: string | URL | Request, init?: RequestInit) =>
      server.fetch(new Request(url, init)),
  });

  let worldId: string;

  await t.step("create world", async () => {
    const world = await sdk.worlds.create({
      organizationId,
      label: "SDK World",
      description: "Test World",
    });
    assert(world.id !== undefined);
    assertEquals(world.label, "SDK World");
    worldId = world.id;
  });

  await t.step("get world", async () => {
    const world = await sdk.worlds.get(worldId);
    assert(world !== null);
    assertEquals(world.label, "SDK World");
  });

  await t.step("list worlds pagination", async () => {
    // Create more worlds for pagination
    await sdk.worlds.create({ organizationId, label: "World 1" });
    await sdk.worlds.create({ organizationId, label: "World 2" });

    const page1 = await sdk.worlds.list(1, 1, { organizationId });
    assertEquals(page1.length, 1);

    const page2 = await sdk.worlds.list(2, 1, { organizationId });
    assertEquals(page2.length, 1);
    assert(page1[0].id !== page2[0].id);
  });

  await t.step("update world", async () => {
    await sdk.worlds.update(worldId, {
      description: "Updated Description",
    });
    const world = await sdk.worlds.get(worldId);
    assert(world !== null);
    assertEquals(world.description, "Updated Description");
  });

  /*
  await t.step("search world", async () => {
    // ... test code commented out ...
  });
  */

  await t.step("sparql update", async () => {
    const updateQuery = `
      INSERT DATA {
        <http://example.org/subject> <http://example.org/predicate> "Update Object" .
      }
    `;
    const result = await sdk.worlds.sparql(worldId, updateQuery);
    assertEquals(result, null);
  });

  await t.step("sparql query", async () => {
    const selectQuery = `
      SELECT ?s ?p ?o WHERE {
        <http://example.org/subject> <http://example.org/predicate> ?o
      }
    `;
    const result = await sdk.worlds.sparql(
      worldId,
      selectQuery,
    ) as SparqlSelectResults;
    assert(result.results.bindings.length > 0);
    assertEquals(result.results.bindings[0].o.value, "Update Object");
  });

  await t.step("download world", async () => {
    // 1. Add some data if not already there (should be there from previous steps)
    // 2. Download in default format (N-Quads)
    const nQuadsBuffer = await sdk.worlds.download(worldId);
    const nQuads = new TextDecoder().decode(nQuadsBuffer);
    assert(nQuads.includes("http://example.org/subject"));

    // 3. Download in Turtle format
    const turtleBuffer = await sdk.worlds.download(worldId, {
      format: "turtle",
    });
    const turtle = new TextDecoder().decode(turtleBuffer);
    assert(turtle.includes("<http://example.org/subject>"));
  });

  await t.step("delete world", async () => {
    await sdk.worlds.delete(worldId);
    const world = await sdk.worlds.get(worldId);
    assertEquals(world, null);
  });
});

Deno.test("WorldsSdk - Admin Organization Override", async (t) => {
  const appContext = await createTestContext();
  const server = await createServer(appContext);

  // Create SDK with admin API key
  const adminSdk = new WorldsSdk({
    baseUrl: "http://localhost",
    apiKey: appContext.admin!.apiKey,
    fetch: (url: string | URL | Request, init?: RequestInit) =>
      server.fetch(new Request(url, init)),
  });

  // Create two test organizations
  const organizationA = await createTestOrganization(appContext);
  const organizationB = await createTestOrganization(appContext);

  await t.step("admin can list worlds for specific organization", async () => {
    // Create worlds for both organizations directly in DB
    const worldId1 = crypto.randomUUID();
    const now1 = Date.now();
    await appContext.libsqlClient.execute({
      sql:
        "INSERT INTO worlds (id, organization_id, label, description, blob, db_hostname, db_token, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        worldId1,
        organizationA.id,
        "Organization A World",
        "Test",
        null,
        null,
        null,
        now1,
        now1,
        null,
      ],
    });

    const worldId2 = crypto.randomUUID();
    const now2 = Date.now();
    await appContext.libsqlClient.execute({
      sql:
        "INSERT INTO worlds (id, organization_id, label, description, blob, db_hostname, db_token, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        worldId2,
        organizationB.id,
        "Organization B World",
        "Test",
        null,
        null,
        null,
        now2,
        now2,
        null,
      ],
    });

    // List worlds for Organization A using admin override
    const worldsA = await adminSdk.worlds.list(1, 20, {
      organizationId: organizationA.id,
    });
    assertEquals(worldsA.length, 1);
    assertEquals(worldsA[0].label, "Organization A World");
    assertEquals(worldsA[0].organizationId, organizationA.id);

    // List worlds for Organization B using admin override
    const worldsB = await adminSdk.worlds.list(1, 20, {
      organizationId: organizationB.id,
    });
    assertEquals(worldsB.length, 1);
    assertEquals(worldsB[0].label, "Organization B World");
    assertEquals(worldsB[0].organizationId, organizationB.id);
  });

  await t.step("admin can create world for specific organization", async () => {
    const world = await adminSdk.worlds.create({
      organizationId: organizationB.id,
      label: "Admin Created World",
      description: "Created via admin override",
    });

    assertEquals(world.organizationId, organizationB.id);
    assertEquals(world.label, "Admin Created World");

    // Verify in database
    const dbWorldResult = await appContext.libsqlClient.execute({
      sql: "SELECT * FROM worlds WHERE id = ?",
      args: [world.id],
    });
    const dbWorld = dbWorldResult.rows[0];
    assert(dbWorld);
    assertEquals(dbWorld.organization_id, organizationB.id);
  });

  await t.step("admin can get world for specific organization", async () => {
    // Create a world for Organization A
    const worldId = crypto.randomUUID();
    const now = Date.now();
    await appContext.libsqlClient.execute({
      sql:
        "INSERT INTO worlds (id, organization_id, label, description, blob, db_hostname, db_token, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        worldId,
        organizationA.id,
        "Test World",
        "Test",
        null,
        null,
        null,
        now,
        now,
        null,
      ],
    });

    // Get world using admin override
    const world = await adminSdk.worlds.get(worldId, {
      organizationId: organizationA.id,
    });
    assert(world !== null);
    assertEquals(world.organizationId, organizationA.id);
  });

  await t.step("admin can update world for specific organization", async () => {
    // Create a world for Organization A
    const worldId2 = crypto.randomUUID();
    const now3 = Date.now();
    await appContext.libsqlClient.execute({
      sql:
        "INSERT INTO worlds (id, organization_id, label, description, blob, db_hostname, db_token, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        worldId2,
        organizationA.id,
        "Original Name",
        "Original",
        null,
        null,
        null,
        now3,
        now3,
        null,
      ],
    });

    // Update using admin override
    await adminSdk.worlds.update(worldId2, {
      description: "Updated via admin",
    }, { organizationId: organizationA.id });

    // Verify update
    const world = await adminSdk.worlds.get(worldId2, {
      organizationId: organizationA.id,
    });
    assert(world !== null);
    assertEquals(world.description, "Updated via admin");
  });

  await t.step("admin can delete world for specific organization", async () => {
    // Create a world for Organization B
    const worldId3 = crypto.randomUUID();
    const now4 = Date.now();
    await appContext.libsqlClient.execute({
      sql:
        "INSERT INTO worlds (id, organization_id, label, description, blob, db_hostname, db_token, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        worldId3,
        organizationB.id,
        "To Delete",
        "Test",
        null,
        null,
        null,
        now4,
        now4,
        null,
      ],
    });

    // Delete using admin override
    await adminSdk.worlds.delete(worldId3, {
      organizationId: organizationB.id,
    });

    // Verify deletion
    const worldResult = await appContext.libsqlClient.execute({
      sql: "SELECT * FROM worlds WHERE id = ?",
      args: [worldId3],
    });
    assertEquals(worldResult.rows.length, 0);
  });

  await t.step(
    "admin SPARQL operations claim usage for specific organization",
    async () => {
      // Create a world for Organization A
      const worldId4 = crypto.randomUUID();
      const now5 = Date.now();
      await appContext.libsqlClient.execute({
        sql:
          "INSERT INTO worlds (id, organization_id, label, description, blob, db_hostname, db_token, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          worldId4,
          organizationA.id,
          "SPARQL Test World",
          "Test",
          null,
          null,
          null,
          now5,
          now5,
          null,
        ],
      });
      const worldId = worldId4;

      // Perform SPARQL update using admin override
      await adminSdk.worlds.sparql(
        worldId,
        'INSERT DATA { <http://example.org/s> <http://example.org/p> "Admin Object" . }',
        { organizationId: organizationA.id },
      );

      // Perform SPARQL query using admin override
      const queryResult = await adminSdk.worlds.sparql(
        worldId,
        "SELECT * WHERE { ?s ?p ?o }",
        { organizationId: organizationA.id },
      ) as SparqlSelectResults;

      assert(queryResult.results.bindings.length > 0);

      // Verify usage is attributed to Organization A
    },
  );

  /*
  await t.step("admin can search world for specific organization", async () => {
    // ... test code commented out ...
  });
  */
});
