import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { resolveWorldDatabase, getWorldSdk } from "../src/lib/world-db";
import { sha256Hex } from "../src/lib/crypto";

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));

const getWorldSdkMock = vi.mocked(getWorldSdk);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);



const env = {
  DB: {} as any,
  WORLDS_ADMIN_KEY: "test-admin-key",
  RATE_LIMIT_RPM: "6000",
  RATE_LIMIT_BURST: "1000",
  MAX_IMPORT_QUADS: "10",
  MAX_IMPORT_BYTES: "1048576",
  SPARQL_MAX_QUERY_LENGTH: "100",
  SPARQL_MAX_RESULTS: "10",
  WAZOO_ENV: "test",
} as unknown as Env;

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const READ_ONLY_TOKEN = "test-read-only-token";
const FULL_TOKEN = "test-full-token";

const worldRef = {
  worldUid: "test-world",
  namespace: "ns",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};

function request(token: string | null, path: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        ...(init.headers as Record<string, string>),
      },
    },
    env,
    executionCtx,
  );
}

let readOnlyHashVal = "";
let fullHashVal = "";

vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uid: vi.fn(() => "mock-uid"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

import { getDb } from "../src/lib/db";
const getDbMock = vi.mocked(getDb);

beforeAll(async () => {
  readOnlyHashVal = await sha256Hex(READ_ONLY_TOKEN);
  fullHashVal = await sha256Hex(FULL_TOKEN);
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveWorldDatabaseMock.mockResolvedValue(worldRef as never);
  getWorldSdkMock.mockResolvedValue({
    sparql: vi.fn().mockResolvedValue({ kind: "ask", data: { boolean: true } }),
    import: vi.fn().mockResolvedValue({}),
  } as never);

  // Mock D1 for auth queries — intercept prepare().bind().all()
  const apiKeyRows: Record<string, any> = {};
  apiKeyRows[readOnlyHashVal] = { namespace: "ns", world_id: null, scopes: '["data:read"]' };
  apiKeyRows[fullHashVal] = { namespace: "ns", world_id: null, scopes: '["data:read","data:write"]' };

  const mockDb = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          if (sql.includes("api_keys") && args[0]) {
            const row = apiKeyRows[args[0] as string];
            return { results: row ? [row] : [] };
          }
          return { results: [] };
        },
        first: async () => {
          if (sql.includes("api_keys") && args[0]) {
            return apiKeyRows[args[0] as string] ?? null;
          }
          return null;
        },
        run: async () => ({ results: [], meta: { changes: 1 } }),
      }),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ results: [], meta: { changes: 1 } }),
    }),
    batch: async () => [],
    exec: async () => {},
  } as any;
  getDbMock.mockReturnValue(mockDb);
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-key bucket is exhausted", async () => {
    const prevRpm = env.RATE_LIMIT_RPM;
    const prevBurst = env.RATE_LIMIT_BURST;
    env.RATE_LIMIT_RPM = "60";
    env.RATE_LIMIT_BURST = "2";
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request("rate-limit-test-token", "/worlds", {
          method: "GET",
        });
        statuses.push(res.status);
      }
      // Bucket of 2: first request seeds it, next two consume, fourth is limited.
      expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
      expect(statuses[3]).toBe(429);

      const limited = await request("rate-limit-test-token", "/worlds", {
        method: "GET",
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBeTruthy();
      const body = (await limited.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("RATE_LIMITED");
    } finally {
      env.RATE_LIMIT_RPM = prevRpm;
      env.RATE_LIMIT_BURST = prevBurst;
    }
  });

  it("exempts the health endpoint from rate limiting", async () => {
    const prevRpm = env.RATE_LIMIT_RPM;
    const prevBurst = env.RATE_LIMIT_BURST;
    env.RATE_LIMIT_RPM = "60";
    env.RATE_LIMIT_BURST = "1";
    try {
      for (let i = 0; i < 5; i += 1) {
        const res = await request(null, "/health", { method: "GET" });
        expect(res.status).toBe(200);
      }
    } finally {
      env.RATE_LIMIT_RPM = prevRpm;
      env.RATE_LIMIT_BURST = prevBurst;
    }
  });
});

describe("import caps", () => {
  it("rejects a JSON import above the per-request quad cap with 413", async () => {
    const quads = Array.from({ length: 11 }, (_, i) => ({
      subject: `urn:s${i}`,
      predicate: "urn:p",
      object: `urn:o${i}`,
    }));
    const res = await request(FULL_TOKEN, "/worlds/test-world/import", {
      method: "POST",
      body: JSON.stringify({
        contentType: "application/json",
        data: JSON.stringify(quads),
      }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects a plain-text import above the chunk cap with 413", async () => {
    const lines = Array.from({ length: 11 }, (_, i) => `chunk ${i}`);
    const res = await request(FULL_TOKEN, "/worlds/test-world/import", {
      method: "POST",
      body: JSON.stringify({
        contentType: "text/plain",
        data: lines.join("\n"),
      }),
    });
    expect(res.status).toBe(413);
  });
});

describe("SPARQL guards", () => {
  it("rejects queries above the length cap before touching the engine", async () => {
    const res = await request(FULL_TOKEN, "/worlds/test-world/sparql", {
      method: "POST",
      body: JSON.stringify({
        query: "SELECT * WHERE { ?s ?p ?o } ".repeat(20),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("QUERY_TOO_LARGE");
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });
});

describe("scope enforcement", () => {
  it("rejects a data:read key on a write route (import) with 403", async () => {
    const res = await request(READ_ONLY_TOKEN, "/worlds/test-world/import", {
      method: "POST",
      body: JSON.stringify({ data: "x", contentType: "text/plain" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toContain("data:write");
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });

  it("allows a data:read key on a read route (sparql)", async () => {
    const res = await request(READ_ONLY_TOKEN, "/worlds/test-world/sparql", {
      method: "POST",
      body: JSON.stringify({ query: "SELECT * WHERE { ?s ?p ?o }" }),
    });
    expect(res.status).toBe(200);
  });
});
