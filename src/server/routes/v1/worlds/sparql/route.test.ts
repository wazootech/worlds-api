import { assert, assertEquals } from "@std/assert";
import { Parser, Store } from "n3";
import {
  createTestContext,
  createTestOrganization,
  type TestContext,
} from "#/server/testing.ts";
import { generateBlobFromN3Store } from "#/server/blobs/n3.ts";
import createRoute from "./route.ts";
import { insertWorld } from "#/server/databases/core/worlds/queries.sql.ts";
import { BlobsService } from "#/server/databases/world/blobs/service.ts";

/**
 * For a comprehensive suite of test cases for standard SPARQL endpoints, see:
 * https://www.w3.org/2009/sparql/docs/tests/summary.html
 */

async function setWorldData(
  testContext: TestContext,
  worldId: string,
  ttl: string,
) {
  const parser = new Parser();
  const quads = parser.parse(ttl);
  const store = new Store();
  store.addQuads(quads);
  const blob = await generateBlobFromN3Store(store);
  const blobData = new Uint8Array(await blob.arrayBuffer());

  const managed = await testContext.databaseManager.get(worldId);
  const blobsService = new BlobsService(managed.database);
  await blobsService.set(blobData, Date.now());
}

Deno.test("SPARQL API routes - GET operations", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "GET /v1/worlds/:world/sparql returns service description when no query",
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
      await testContext.databaseManager!.create(worldId);

      const resp = await app.fetch(
        new Request(`http://localhost/v1/worlds/${worldId}/sparql`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }),
      );

      assertEquals(resp.status, 200);
      const contentType = resp.headers.get("content-type");
      assert(
        contentType === "text/turtle" || contentType === "application/rdf+xml",
      );
      const body = await resp.text();
      assert(body.includes("Service") || body.length > 0);
    },
  );
});

Deno.test("SPARQL API routes - POST operations (Query)", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "POST /v1/worlds/:world/sparql (query parameter) executes SPARQL Query",
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
      await testContext.databaseManager!.create(worldId);

      // Set up test data
      await setWorldData(
        testContext,
        worldId,
        '<http://example.com/s> <http://example.com/p> "o" .',
      );

      const query = encodeURIComponent("SELECT ?s WHERE { ?s ?p ?o }");
      const req = new Request(
        `http://localhost/v1/worlds/${worldId}/sparql?query=${query}`,
        {
          method: "POST",
          headers: {
            "Accept": "application/sparql-results+json",
            "Authorization": `Bearer ${apiKey}`,
          },
        },
      );

      const res = await app.fetch(req);
      if (res.status !== 200) {
        console.log("SPARQL Query POST failed:", await res.text());
        assertEquals(res.status, 200);
      }
      assertEquals(
        res.headers.get("content-type"),
        "application/sparql-results+json",
      );
      const json = await res.json();

      // Check Standard SPARQL JSON Results Structure
      assert(json.head);
      assert(Array.isArray(json.head.vars));
      assertEquals(json.head.vars.length, 1);
      assertEquals(json.head.vars[0], "s");

      assert(json.results);
      assert(Array.isArray(json.results.bindings));
      assertEquals(json.results.bindings.length, 1);

      const binding = json.results.bindings[0];
      assertEquals(binding.s.type, "uri");
      assertEquals(binding.s.value, "http://example.com/s");
    },
  );

  await t.step(
    "POST /v1/worlds/:world/sparql (body) executes SPARQL Query",
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
      await testContext.databaseManager!.create(worldId);

      // Set up test data
      await setWorldData(
        testContext,
        worldId,
        '<http://example.com/s2> <http://example.com/p2> "o2" .',
      );

      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const req = new Request(
        `http://localhost/v1/worlds/${worldId}/sparql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/sparql-query",
            "Accept": "application/sparql-results+json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: query,
        },
      );

      const res = await app.fetch(req);
      if (res.status !== 200) {
        console.log("SPARQL Query POST Response body:", await res.text());
      }
      assertEquals(res.status, 200);
      const json = await res.json();
      assert(json.head);
      assert(json.results);
      assert(json.results.bindings.length >= 1);
    },
  );
});

Deno.test("SPARQL API routes - POST operations (Update)", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "POST /v1/worlds/:world/sparql executes SPARQL Update",
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
      await testContext.databaseManager!.create(worldId);

      // Set up initial data
      await setWorldData(
        testContext,
        worldId,
        '<http://example.com/s> <http://example.com/p> "o" .',
      );

      // Execute update
      const updateQuery =
        'INSERT { <http://example.com/s2> <http://example.com/p2> "o2" . } WHERE { }';
      const req = new Request(
        `http://localhost/v1/worlds/${worldId}/sparql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/sparql-update",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: updateQuery,
        },
      );

      const res = await app.fetch(req);
      if (res.status !== 204) {
        console.log("SPARQL Update failed:", await res.text());
        assertEquals(res.status, 204);
      }
      assertEquals(res.status, 204);

      // Verify update by querying - need to wait a bit for the update to persist
      await new Promise((resolve) => setTimeout(resolve, 500));

      const verifyQuery = encodeURIComponent("SELECT ?s WHERE { ?s ?p ?o }");
      const verifyReq = new Request(
        `http://localhost/v1/worlds/${worldId}/sparql?query=${verifyQuery}`,
        {
          method: "POST",
          headers: {
            "Accept": "application/sparql-results+json",
            "Authorization": `Bearer ${apiKey}`,
          },
        },
      );

      const verifyRes = await app.fetch(verifyReq);
      assertEquals(verifyRes.status, 200);
      const json = await verifyRes.json();
      assert(json.results.bindings.length >= 2);
    },
  );
});

Deno.test("SPARQL API routes - Error handling", async (t) => {
  const testContext = await createTestContext();
  const app = createRoute(testContext);

  await t.step(
    "POST /v1/worlds/:world/sparql returns 404 for non-existent world",
    async () => {
      const { apiKey } = await createTestOrganization(testContext);

      const query = encodeURIComponent("SELECT ?s WHERE { ?s ?p ?o }");
      const req = new Request(
        `http://localhost/v1/worlds/non-existent-world/sparql?query=${query}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        },
      );

      const res = await app.fetch(req);
      assertEquals(res.status, 404);
    },
  );
});
