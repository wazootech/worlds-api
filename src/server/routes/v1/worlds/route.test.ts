import { assert, assertEquals } from "@std/assert";
import { createTestContext, createTestOrganization } from "#/server/testing.ts";
import createRoute from "./route.ts";
import { createServer } from "#/server/server.ts";
import {
  insertWorld,
  selectWorldById,
  updateWorld,
} from "#/server/databases/core/worlds/queries.sql.ts";
import { BlobsService } from "#/server/databases/world/blobs/service.ts";

Deno.test("Worlds API routes - GET operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step("GET /v1/worlds/:world returns world metadata", async () => {
    const { id: organizationId, apiKey } = await createTestOrganization(
      testContext,
    );
    const worldId = crypto.randomUUID();
    const now = Date.now();
    await testContext.database.execute({
      sql: insertWorld,
      args: [
        worldId,
        organizationId,
        "Test World",
        "Test Description",
        null, // db_hostname
        null, // db_auth_token
        now,
        now,
        null, // deleted_at
        null, // blob
      ],
    });
    await testContext.databaseManager?.create(worldId);

    const resp = await app.fetch(
      new Request(`http://localhost/v1/worlds/${worldId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      }),
    );

    if (resp.status !== 200) {
      console.log("Response body:", await resp.text());
    }
    assertEquals(resp.status, 200);
    assertEquals(resp.headers.get("content-type"), "application/json");

    const world = await resp.json();
    assertEquals(world.organizationId, organizationId);
    assertEquals(world.label, "Test World");
    assert(typeof world.createdAt === "number");
    assert(typeof world.updatedAt === "number");
    assertEquals(world.deletedAt, null);
  });

  await t.step(
    "GET /v1/worlds/:world returns 404 for non-existent world",
    async () => {
      const { apiKey } = await createTestOrganization(testContext);

      const resp = await app.fetch(
        new Request("http://localhost/v1/worlds/non-existent-world", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }),
      );

      assertEquals(resp.status, 404);
    },
  );

  await t.step(
    "GET /v1/worlds/:world returns 404 for deleted world",
    async () => {
      const { id: organizationId, apiKey } = await createTestOrganization(
        testContext,
      );
      const worldId = crypto.randomUUID();
      const now = Date.now();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // db_hostname
          null, // db_auth_token
          now,
          now,
          null, // deleted_at
        ],
      });
      await testContext.databaseManager?.create(worldId);

      // Mark world as deleted
      await testContext.database.execute({
        sql: updateWorld,
        args: [
          "Test World",
          "Test Description",
          Date.now(),
          null,
          null,
          null,
          worldId,
        ],
      });
      // Actually delete it
      await testContext.database.execute({
        sql: "UPDATE worlds SET deleted_at = ? WHERE id = ?",
        args: [Date.now(), worldId],
      });

      const resp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }),
      );

      assertEquals(resp.status, 404);
    },
  );

  await t.step(
    "GET /v1/worlds/:world/download returns world data",
    async () => {
      const { id: organizationId, apiKey } = await createTestOrganization(
        testContext,
      );
      const worldId = crypto.randomUUID();
      const now = Date.now();
      const quads =
        "<http://example.org/s> <http://example.org/p> <http://example.org/o> <http://example.org/g> .";
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // db_hostname
          null, // db_auth_token
          now,
          now,
          null, // deleted_at
        ],
      });

      // Initialize world data in scoped DB
      const managed = await testContext.databaseManager.create(worldId);
      const blobsService = new BlobsService(managed.database);
      await blobsService.set(new TextEncoder().encode(quads), now);

      // Test default (N-Quads)
      const resp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}/download`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }),
      );

      assertEquals(resp.status, 200);
      assertEquals(resp.headers.get("content-type"), "application/n-quads");
      const body = await resp.text();
      assert(body.includes("http://example.org/s"));

      // Test Turtle format via format param
      const turtleResp = await app.fetch(
        new Request(
          `http://localhost/v1/worlds/${worldId}/download?format=turtle`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
            },
          },
        ),
      );

      assertEquals(turtleResp.status, 200);
      assertEquals(turtleResp.headers.get("content-type"), "text/turtle");
      const turtleBody = await turtleResp.text();
      assert(turtleBody.includes("<http://example.org/s>"));
    },
  );

  await t.step(
    "GET /v1/worlds/:world/download returns 401 for unauthorized",
    async () => {
      const { id: organizationId } = await createTestOrganization(
        testContext,
      );
      const worldId = crypto.randomUUID();
      const now = Date.now();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          null,
          null, // db_hostname
          null, // db_auth_token
          now,
          now,
          null, // deleted_at
        ],
      });
      await testContext.databaseManager?.create(worldId);
      await testContext.databaseManager?.create(worldId);

      const resp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}/download`, {
          method: "GET",
        }),
      );

      assertEquals(resp.status, 401);
    },
  );
});

Deno.test("Worlds API routes - POST operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step("POST /v1/worlds creates a new world", async () => {
    const { id: organizationId, apiKey } = await createTestOrganization(
      testContext,
    );

    const req = new Request("http://localhost/v1/worlds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        organizationId,
        label: "New World",
        description: "New Description",
      }),
    });
    const res = await app.fetch(req);
    if (res.status !== 201) {
      console.log("POST /v1/worlds failed:", await res.text());
      assertEquals(res.status, 201);
    }
    assertEquals(res.status, 201);

    const world = await res.json();
    assertEquals(world.label, "New World");
    assertEquals(world.description, "New Description");
    assert(typeof world.updatedAt === "number");
    assert(typeof world.id === "string");
    assert(typeof world.createdAt === "number");
    assert(typeof world.updatedAt === "number");
    assertEquals(world.deletedAt, null);
  });
});

Deno.test("Worlds API routes - PUT operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "PUT /v1/worlds/:world updates world description",
    async () => {
      const { id: organizationId, apiKey } = await createTestOrganization(
        testContext,
      );
      const worldId = crypto.randomUUID();
      const now = Date.now();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // db_hostname
          null, // db_auth_token
          now,
          now,
          null, // deleted_at
        ],
      });
      await testContext.databaseManager?.create(worldId);

      // Update description
      const updateResp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ description: "Updated description" }),
        }),
      );
      if (updateResp.status !== 204) {
        console.log("PUT /v1/worlds/:world failed:", await updateResp.text());
        assertEquals(updateResp.status, 204);
      }
      assertEquals(updateResp.status, 204);

      // Verify update
      const getResp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }),
      );
      assertEquals(getResp.status, 200);
      const world = await getResp.json();
      assertEquals(world.description, "Updated description");
    },
  );

  await t.step(
    "PUT /v1/worlds/:world returns 400 for invalid JSON",
    async () => {
      const { id: organizationId, apiKey } = await createTestOrganization(
        testContext,
      );
      const worldId = crypto.randomUUID();
      const now = Date.now();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // db_hostname
          null, // db_auth_token
          now,
          now,
          null, // deleted_at
        ],
      });
      await testContext.databaseManager?.create(worldId);

      const invalidJsonResp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: "invalid-json",
        }),
      );
      assertEquals(invalidJsonResp.status, 400);
    },
  );

  await t.step(
    "PUT /v1/worlds/:world returns 404 for non-existent world",
    async () => {
      const { apiKey } = await createTestOrganization(testContext);

      const updateResp = await app.fetch(
        new Request("http://localhost/v1/worlds/non-existent-world", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ description: "Test" }),
        }),
      );
      assertEquals(updateResp.status, 404);
    },
  );
});

Deno.test("Worlds API routes - DELETE operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step("DELETE /v1/worlds/:world deletes a world", async () => {
    const { id: organizationId, apiKey } = await createTestOrganization(
      testContext,
    );
    const worldId = crypto.randomUUID();
    const now = Date.now();
    await testContext.database.execute({
      sql: insertWorld,
      args: [
        worldId,
        organizationId,
        "Test World",
        "Test Description",
        null, // db_hostname
        null, // db_auth_token
        now, // created_at
        now, // updated_at
        null, // deleted_at
        null, // blob
      ],
    });
    await testContext.databaseManager?.create(worldId);

    // Delete world
    const deleteResp = await app.fetch(
      new Request(`http://localhost/v1/worlds/${worldId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      }),
    );
    assertEquals(deleteResp.status, 204);

    // Verify deletion - should return 404
    const getResp = await app.fetch(
      new Request(`http://localhost/v1/worlds/${worldId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      }),
    );
    assertEquals(getResp.status, 404);

    // Verify row deletion
    const dbResult = await testContext.database.execute({
      sql: selectWorldById,
      args: [worldId],
    });
    assertEquals(dbResult.rows.length, 0);
  });
});

Deno.test("Worlds API routes - List operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "GET /v1/worlds returns paginated list of worlds for organization",
    async () => {
      const { id: organizationId, apiKey } = await createTestOrganization(
        testContext,
      );

      const now1 = Date.now();
      const worldId1 = crypto.randomUUID();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId1,
          organizationId,
          "Test World 1",
          "Test Description 1",
          null, // db_hostname
          null, // db_auth_token
          now1,
          now1,
          null, // deleted_at
          null, // blob
        ],
      });
      await testContext.databaseManager?.create(worldId1);

      const now2 = Date.now();
      const worldId2 = crypto.randomUUID();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldId2,
          organizationId,
          "Test World 2",
          "Test Description 2",
          null, // db_hostname
          null, // db_auth_token
          now2,
          now2,
          null, // deleted_at
          null, // blob
        ],
      });
      await testContext.databaseManager?.create(worldId2);

      const resp = await app.fetch(
        new Request(
          `http://localhost/v1/worlds?page=1&pageSize=20&organizationId=${organizationId}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
            },
          },
        ),
      );

      assertEquals(resp.status, 200);
      const worlds = await resp.json();
      assert(Array.isArray(worlds));
      assert(worlds.length >= 2);

      const worldNames = worlds.map((w: { label: string }) => w.label);
      assert(worldNames.includes("Test World 1"));
      assert(worldNames.includes("Test World 2"));
    },
  );
});

Deno.test("Admin Organization Override", async (t) => {
  const testContext = await createTestContext();
  const { admin } = testContext;
  const app = await createServer(testContext);
  const adminApiKey = admin!.apiKey;

  await t.step(
    "Admin can list worlds for a specific organization",
    async () => {
      const organizationA = await createTestOrganization(
        testContext,
      );
      const organizationB = await createTestOrganization(
        testContext,
      );

      // Create world for Organization A
      const now1 = Date.now();
      const worldIdA = crypto.randomUUID();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldIdA,
          organizationA.id,
          "World A",
          "Description A",
          null, // db_hostname
          null, // db_auth_token
          now1,
          now1,
          null, // deleted_at
          null, // blob
        ],
      });
      await testContext.databaseManager?.create(worldIdA);

      // Create world for Organization B
      const now2 = Date.now();
      const worldIdB = crypto.randomUUID();
      await testContext.database.execute({
        sql: insertWorld,
        args: [
          worldIdB,
          organizationB.id,
          "World B",
          "Description B",
          null, // db_hostname
          null, // db_auth_token
          now2,
          now2,
          null, // deleted_at
          null, // blob
        ],
      });
      await testContext.databaseManager?.create(worldIdB);

      // Admin list for Organization A
      const respA = await app.fetch(
        new Request(
          `http://localhost/v1/worlds?organizationId=${organizationA.id}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${adminApiKey}`,
            },
          },
        ),
      );
      assertEquals(respA.status, 200);
      const bodyA = await respA.json();
      assertEquals(bodyA.length, 1);
      assertEquals(bodyA[0].label, "World A");

      // Admin list for Organization B
      const respB = await app.fetch(
        new Request(
          `http://localhost/v1/worlds?organizationId=${organizationB.id}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${adminApiKey}`,
            },
          },
        ),
      );
      assertEquals(respB.status, 200);
      const bodyB = await respB.json();
      assertEquals(bodyB.length, 1);
      assertEquals(bodyB[0].label, "World B");
    },
  );

  await t.step(
    "Admin can create world for a specific organization",
    async () => {
      const organizationC = await createTestOrganization(
        testContext,
      );

      const resp = await app.fetch(
        new Request(
          "http://localhost/v1/worlds",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${adminApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              organizationId: organizationC.id,
              label: "World C",
              description: "Created by Admin",
            }),
          },
        ),
      );
      assertEquals(resp.status, 201);
      const world = await resp.json();
      assertEquals(world.organizationId, organizationC.id);
      assertEquals(world.label, "World C");

      // Verify in DB
      const dbWorldResult = await testContext.database.execute({
        sql: selectWorldById,
        args: [world.id],
      });
      assert(dbWorldResult.rows.length > 0);
      assertEquals(dbWorldResult.rows[0].organization_id, organizationC.id);
    },
  );
});
