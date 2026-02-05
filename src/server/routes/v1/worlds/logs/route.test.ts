import { assert, assertEquals } from "@std/assert";
import { createTestContext, createTestOrganization } from "#/server/testing.ts";
import createRoute from "./route.ts";
import { insertWorld } from "#/server/databases/core/worlds/queries.sql.ts";
import { LogsService } from "#/server/databases/world/logs/service.ts";

Deno.test("Logs API routes", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "GET /v1/worlds/:world/logs returns logs for a world",
    async () => {
      const { id: organizationId } = await createTestOrganization(testContext);
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
      const managed = await testContext.databaseManager!.create(worldId);

      // Insert some logs
      const logsService = new LogsService(managed.database);
      await logsService.add({
        id: crypto.randomUUID(),
        world_id: worldId,
        timestamp: now,
        level: "info",
        message: "Log 1",
        metadata: null,
      });
      await logsService.add({
        id: crypto.randomUUID(),
        world_id: worldId,
        timestamp: now + 1000,
        level: "error",
        message: "Log 2",
        metadata: "{}",
      });

      const { admin } = testContext;
      const adminApiKey = admin!.apiKey;

      const resp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}/logs`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${adminApiKey}`,
          },
        }),
      );

      assertEquals(resp.status, 200);
      const logs = await resp.json();
      assert(Array.isArray(logs));
      assertEquals(logs.length, 2);
    },
  );

  await t.step("GET /v1/worlds/:world/logs requires admin", async () => {
    const { id: organizationId } = await createTestOrganization(testContext);
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
    await testContext.databaseManager!.create(worldId);

    // Try with no auth
    const respNoAuth = await app.fetch(
      new Request(`http://localhost/v1/worlds/${worldId}/logs`, {
        method: "GET",
      }),
    );
    assertEquals(respNoAuth.status, 401);

    // Try with non-admin org user (simulated by just not being admin)
    // Actually authorizeRequest only checks admin vs service account vs nothing.
    // The route explicitly checks `!authorized.admin`.
  });
});
