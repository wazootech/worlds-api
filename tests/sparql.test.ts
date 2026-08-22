import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { createLibsqlWorldsSdk } from "@worlds/libsql";
import { resolveWorldDatabase, worldDb } from "../src/lib/world-db";

vi.mock("@worlds/libsql", () => ({
  createLibsqlWorldsSdk: vi.fn(),
}));

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  worldDb: vi.fn(),
}));

const createLibsqlSdkMock = vi.mocked(createLibsqlWorldsSdk);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);
const worldDbMock = vi.mocked(worldDb);

const env = {
  LIBSQL_URL: "file:test.db",
  WORLDS_ADMIN_KEY: "test-admin-key",
  RATE_LIMIT_RPM: "0", // rate limiting is exercised in tests/abuse.test.ts
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

const ALLOWED_ORIGIN = "https://console.wazoo.dev";

function request(body: unknown, signal?: AbortSignal) {
  return app.request(
    "/worlds/test-world/sparql",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-key",
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify(body),
      signal,
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
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
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
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const res = await request({
      query: "SELECT * WHERE { ?s ?p ?o } ORDER BY ?missing",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
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
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const res = await request({ query: "SELECT ?s WHERE { ?s ?p ?o }" });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
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
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const res = await request({ query: "SELECT ?s WHERE { ?s ?p ?o }" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.bindings).toHaveLength(1);
    expect(body.results.bindings[0].s.value).toBe("urn:hello");
  });

  it("executes a SPARQL UPDATE and reports ok", async () => {
    const sparql = vi.fn().mockResolvedValue({ kind: "void" });
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const res = await request({
      query: 'INSERT DATA { <urn:subject> <urn:predicate> "value" }',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(sparql).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'INSERT DATA { <urn:subject> <urn:predicate> "value" }',
        timeoutMs: 5000,
      }),
    );
  });

  it("forwards the client-disconnect signal and timeout to the SPARQL client", async () => {
    const controller = new AbortController();
    const sparql = vi.fn().mockResolvedValue({ kind: "void" });
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const res = await request(
      { query: "SELECT * WHERE { ?s ?p ?o }" },
      controller.signal,
    );
    expect(res.status).toBe(200);
    expect(sparql).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT * WHERE { ?s ?p ?o }",
        timeoutMs: 5000,
      }),
    );
    // The route passes the request's disconnect signal through (the Request
    // wrapper exposes a derived signal that aborts with the caller's).
    const calledWith = sparql.mock.calls[0][0];
    expect(calledWith.signal).toBeDefined();
    expect(calledWith.signal.aborted).toBe(false);
    controller.abort();
    expect(calledWith.signal.aborted).toBe(true);
  });

  it("does not serialize an error body when the client disconnects mid-query", async () => {
    const controller = new AbortController();
    const sparql = vi.fn().mockImplementation(
      (req: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          // The engine honors the signal: it rejects promptly when the
          // request is aborted (the SDK's executeSparql composed controller).
          // Handle both a pre-aborted request and a mid-flight abort.
          if (req.signal.aborted) {
            reject(
              req.signal.reason instanceof Error
                ? req.signal.reason
                : new Error("SPARQL query aborted"),
            );
            return;
          }
          req.signal.addEventListener(
            "abort",
            () => {
              reject(
                req.signal.reason instanceof Error
                  ? req.signal.reason
                  : new Error("SPARQL query aborted"),
              );
            },
            { once: true },
          );
        }),
    );
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const promise = request(
      { query: "SELECT * WHERE { ?s ?p ?o }" },
      controller.signal,
    );
    controller.abort(new Error("client disconnected"));
    const res = await promise;

    // The request signal fired, so the route returns without writing a
    // structured error body to the dead connection. The framework's minimal
    // fallback response has no JSON error envelope.
    const body = await res.json().catch(() => null);
    expect(body).toBeNull();
  });

  it("returns a structured 400 for unsupported SPARQL result kinds", async () => {
    const sparql = vi.fn().mockResolvedValue({ kind: "construct" });
    createLibsqlSdkMock.mockResolvedValue({ sparql } as never);

    const res = await request({
      query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_QUERY_KIND");
    expect(body.error.message).toContain("SPARQL UPDATE");
  });
});
