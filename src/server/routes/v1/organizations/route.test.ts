import { assert, assertEquals } from "@std/assert";
import { createTestContext } from "#/server/testing.ts";
import createApp from "./route.ts";
import {
  insertOrganization,
} from "#/server/databases/core/organizations/queries.sql.ts";

Deno.test("Organizations API routes", async (t) => {
  const testContext = await createTestContext();
  const app = createApp(testContext);

  await t.step(
    "GET /v1/organizations returns paginated list of organizations",
    async () => {
      const now1 = Date.now();
      await testContext.database.execute({
        sql: insertOrganization,
        args: [
          "organization_1",
          "Test organization 1",
          "Test description 1",
          "free",
          now1,
          now1,
          null,
        ],
      });

      const now2 = Date.now();
      await testContext.database.execute({
        sql: insertOrganization,
        args: [
          "organization_2",
          "Test organization 2",
          "Test description 2",
          "pro",
          now2,
          now2,
          null,
        ],
      });

      const req = new Request(
        "http://localhost/v1/organizations?page=1&pageSize=20",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const organizations = await res.json();
      assert(Array.isArray(organizations));
      assert(organizations.length >= 2);
    },
  );
});

Deno.test("Organizations API routes - CRUD operations", async (t) => {
  const testContext = await createTestContext();
  const app = createApp(testContext);

  await t.step(
    "POST /v1/organizations creates a new organization",
    async () => {
      const req = new Request("http://localhost/v1/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${testContext.admin!.apiKey}`,
        },
        body: JSON.stringify({
          id: "organization_new",
          description: "Test organization",
          label: "Test Label",
          plan: "free",
        }),
      });
      const res = await app.fetch(req);
      assertEquals(res.status, 201);

      const body = await res.json();
      assertEquals(body.id, "organization_new");
      assertEquals(body.description, "Test organization");
      assertEquals(body.label, "Test Label");
      assertEquals(body.plan, "free");
    },
  );

  await t.step(
    "GET /v1/organizations/:organization retrieves an organization",
    async () => {
      const now = Date.now();
      await testContext.database.execute({
        sql: insertOrganization,
        args: [
          "organization_get",
          "Test organization 2",
          "Test description 2",
          "pro",
          now,
          now,
          null,
        ],
      });
      const organizationId = "organization_get";

      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const organization = await res.json();
      assertEquals(organization.label, "Test organization 2");
      assertEquals(organization.plan, "pro");
    },
  );

  await t.step(
    "PUT /v1/organizations/:organization updates an organization",
    async () => {
      const now = Date.now();
      await testContext.database.execute({
        sql: insertOrganization,
        args: [
          "organization_put",
          "Original label",
          "Original description",
          "free",
          now,
          now,
          null,
        ],
      });
      const organizationId = "organization_put";

      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
          body: JSON.stringify({
            label: "Updated label",
            description: "Updated description",
            plan: "pro",
          }),
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 204);

      const getRes = await app.fetch(
        new Request(
          `http://localhost/v1/organizations/${organizationId}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${testContext.admin!.apiKey}`,
            },
          },
        ),
      );
      const organization = await getRes.json();
      assertEquals(organization.label, "Updated label");
      assertEquals(organization.description, "Updated description");
    },
  );

  await t.step(
    "DELETE /v1/organizations/:organization removes an organization",
    async () => {
      const now = Date.now();
      await testContext.database.execute({
        sql: insertOrganization,
        args: [
          "organization_del",
          "To be deleted",
          "Description",
          "free",
          now,
          now,
          null,
        ],
      });
      const organizationId = "organization_del";

      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}`,
        {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 204);

      const getRes = await app.fetch(
        new Request(
          `http://localhost/v1/organizations/${organizationId}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${testContext.admin!.apiKey}`,
            },
          },
        ),
      );
      assertEquals(getRes.status, 404);
    },
  );
});
