import { assert, assertEquals } from "@std/assert";
import { ulid } from "@std/ulid/ulid";
import { createTestContext } from "#/lib/testing/context.ts";
import createApp from "./route.ts";

Deno.test("Service Accounts API routes", async (t) => {
  const testContext = await createTestContext();
  const app = createApp(testContext);
  const organizationId = "org_" + ulid();

  await t.step(
    "GET /v1/organizations/:organization/service-accounts returns empty list initially",
    async () => {
      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 200);
      const accounts = await res.json();
      assertEquals(accounts, []);
    },
  );

  let createdAccountId: string;

  await t.step(
    "POST /v1/organizations/:organization/service-accounts creates a new service account",
    async () => {
      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
          body: JSON.stringify({
            label: "Test Service Account",
            description: "A service account for testing",
          }),
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 201);
      const account = await res.json();
      assertEquals(account.label, "Test Service Account");
      assertEquals(account.description, "A service account for testing");
      assertEquals(account.organizationId, organizationId);
      assert(account.id);
      assert(account.apiKey);
      createdAccountId = account.id;
    },
  );

  await t.step(
    "GET /v1/organizations/:organization/service-accounts/:account retrieves a service account",
    async () => {
      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts/${createdAccountId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 200);
      const account = await res.json();
      assertEquals(account.id, createdAccountId);
      assertEquals(account.label, "Test Service Account");
    },
  );

  await t.step(
    "PUT /v1/organizations/:organization/service-accounts/:account updates a service account",
    async () => {
      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts/${createdAccountId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
          body: JSON.stringify({
            label: "Updated Service Account",
          }),
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 204);

      // Verify update
      const getReq = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts/${createdAccountId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const getRes = await app.fetch(getReq);
      const account = await getRes.json();
      assertEquals(account.label, "Updated Service Account");
      assertEquals(account.description, "A service account for testing"); // Should remain unchanged
    },
  );

  await t.step(
    "DELETE /v1/organizations/:organization/service-accounts/:account removes a service account",
    async () => {
      const req = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts/${createdAccountId}`,
        {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const res = await app.fetch(req);
      assertEquals(res.status, 204);

      // Verify deletion
      const getReq = new Request(
        `http://localhost/v1/organizations/${organizationId}/service-accounts/${createdAccountId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${testContext.admin!.apiKey}`,
          },
        },
      );
      const getRes = await app.fetch(getReq);
      assertEquals(getRes.status, 404);
    },
  );
});
