import { assert, assertEquals } from "@std/assert";
import { createTestContext, createTestOrganization } from "#/server/testing.ts";
import createRoute from "./route.ts";
import { createServer } from "#/server/server.ts";
import {
  insertWorld,
  selectWorldById,
  updateWorld,
} from "#/server/db/resources/worlds/queries.sql.ts";

Deno.test("Worlds API routes - GET operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step("GET /v1/worlds/:world returns world metadata", async () => {
    const { id: organizationId, apiKey } = await createTestOrganization(
      testContext,
    );
    const worldId = crypto.randomUUID();
    const now = Date.now();
    await testContext.libsqlClient.execute({
      sql: insertWorld,
      args: [
        worldId,
        organizationId,
        "Test World",
        "Test Description",
        null, // blob
        null, // db_hostname
        null, // db_token
        now,
        now,
        null, // deleted_at
      ],
    });

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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // blob
          null, // db_hostname
          null, // db_token
          now,
          now,
          null, // deleted_at
        ],
      });

      // Mark world as deleted
      await testContext.libsqlClient.execute({
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
      await testContext.libsqlClient.execute({
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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          new TextEncoder().encode(quads),
          null, // db_hostname
          null, // db_token
          now,
          now,
          null, // deleted_at
        ],
      });

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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          null,
          null,
          null, // db_hostname
          null, // db_token
          now,
          now,
          null, // deleted_at
        ],
      });

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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // blob
          null, // db_hostname
          null, // db_token
          now,
          now,
          null, // deleted_at
        ],
      });

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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId,
          organizationId,
          "Test World",
          "Test Description",
          null, // blob
          null, // db_hostname
          null, // db_token
          now,
          now,
          null, // deleted_at
        ],
      });

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
    await testContext.libsqlClient.execute({
      sql: insertWorld,
      args: [
        worldId,
        organizationId,
        "Test World",
        "Test Description",
        new Uint8Array([1, 2, 3]), // initial blob
        null, // db_hostname
        null, // db_token
        now, // created_at
        now, // updated_at
        null, // deleted_at
      ],
    });

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
    const dbResult = await testContext.libsqlClient.execute({
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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId1,
          organizationId,
          "Test World 1",
          "Test Description 1",
          null, // blob
          null, // db_hostname
          null, // db_token
          now1,
          now1,
          null, // deleted_at
        ],
      });

      const now2 = Date.now();
      const worldId2 = crypto.randomUUID();
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldId2,
          organizationId,
          "Test World 2",
          "Test Description 2",
          null, // blob
          null, // db_hostname
          null, // db_token
          now2,
          now2,
          null, // deleted_at
        ],
      });

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
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldIdA,
          organizationA.id,
          "World A",
          "Description A",
          null, // blob
          null, // db_hostname
          null, // db_token
          now1,
          now1,
          null, // deleted_at
        ],
      });

      // Create world for Organization B
      const now2 = Date.now();
      const worldIdB = crypto.randomUUID();
      await testContext.libsqlClient.execute({
        sql: insertWorld,
        args: [
          worldIdB,
          organizationB.id,
          "World B",
          "Description B",
          null, // blob
          null, // db_hostname
          null, // db_token
          now2,
          now2,
          null, // deleted_at
        ],
      });

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
      const dbWorldResult = await testContext.libsqlClient.execute({
        sql: selectWorldById,
        args: [world.id],
      });
      assert(dbWorldResult.rows.length > 0);
      assertEquals(dbWorldResult.rows[0].organization_id, organizationC.id);
    },
  );
});
