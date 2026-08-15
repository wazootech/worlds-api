import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { createLibsqlClient } from "@worlds/libsql";
import { resolveWorldDatabase, worldDb } from "../src/lib/world-db";

vi.mock("@worlds/libsql", () => ({
  createLibsqlClient: vi.fn(),
}));

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  worldDb: vi.fn(),
}));

const createLibsqlClientMock = vi.mocked(createLibsqlClient);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);
const worldDbMock = vi.mocked(worldDb);

const env = {
  LIBSQL_URL: "file:test.db",
  WORLDS_ADMIN_KEY: "test-admin-key",
} as unknown as Env;

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const worldRef = {
  worldUid: "test-world",
  namespace: "ns",
  databaseUrl: "file:test.db",
  databaseAuthToken: undefined,
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};

function request(body: unknown) {
  return app.request(
    "/worlds/test-world/sparql",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-key",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
    executionCtx,
  );
}

describe("POST /worlds/:id/sparql endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorldDatabaseMock.mockResolvedValue(worldRef as never);
    worldDbMock.mockReturnValue({} as never);
  });

  it("rejects request without authorization token", async () => {
    const res = await app.request(
      "/worlds/test-world/sparql",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "SELECT * WHERE { ?s ?p ?o }",
        }),
      },
      env,
      executionCtx,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when query is missing", async () => {
    const res = await request({});
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 404 when the world database cannot be resolved", async () => {
    resolveWorldDatabaseMock.mockResolvedValue(null as never);
    const res = await request({ query: "SELECT * WHERE { ?s ?p ?o }" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns a structured 400 with CORS headers when the SPARQL client rejects", async () => {
    const sparql = vi
      .fn()
      .mockRejectedValue(new Error("sort on unbound variable"));
    createLibsqlClientMock.mockResolvedValue({ sparql } as never);

    const res = await request({
      query: "SELECT * WHERE { ?s ?p ?o } ORDER BY ?missing",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toContain("unbound variable");
  });

  it("returns a structured 400 instead of crashing when the bindings stream errors during drain", async () => {
    async function* throwingBindings() {
      yield { s: { type: "uri", value: "urn:ok" } };
      throw new Error("unhandled term comparator");
    }
    const sparql = vi.fn().mockResolvedValue({
      kind: "select",
      data: {
        head: { vars: ["s"] },
        results: { bindings: throwingBindings() },
      },
    });
    createLibsqlClientMock.mockResolvedValue({ sparql } as never);

    const res = await request({ query: "SELECT ?s WHERE { ?s ?p ?o }" });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toContain("unhandled term comparator");
  });

  it("returns select results on the happy path", async () => {
    const sparql = vi.fn().mockResolvedValue({
      kind: "select",
      data: {
        head: { vars: ["s"] },
        results: {
          bindings: [{ s: { type: "uri", value: "urn:hello" } }],
        },
      },
    });
    createLibsqlClientMock.mockResolvedValue({ sparql } as never);

    const res = await request({ query: "SELECT ?s WHERE { ?s ?p ?o }" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.bindings).toHaveLength(1);
    expect(body.results.bindings[0].s.value).toBe("urn:hello");
  });

  it("executes a SPARQL UPDATE and reports ok", async () => {
    const sparql = vi.fn().mockResolvedValue({ kind: "void" });
    createLibsqlClientMock.mockResolvedValue({ sparql } as never);

    const res = await request({
      query: 'INSERT DATA { <urn:subject> <urn:predicate> "value" }',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(sparql).toHaveBeenCalledWith({
      query: 'INSERT DATA { <urn:subject> <urn:predicate> "value" }',
    });
  });

  it("returns a structured 400 for unsupported SPARQL result kinds", async () => {
    const sparql = vi.fn().mockResolvedValue({ kind: "construct" });
    createLibsqlClientMock.mockResolvedValue({ sparql } as never);

    const res = await request({
      query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_QUERY_KIND");
    expect(body.error.message).toContain("SPARQL UPDATE");
  });
});
