import { createClient } from "@libsql/client";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { createLibsqlSdk } from "@worlds/libsql";
import { resolveWorldDatabase, worldDb } from "../src/lib/world-db";
import { sha256Hex } from "../src/lib/crypto";

vi.mock("@worlds/libsql", () => ({
  createLibsqlSdk: vi.fn(),
}));

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  worldDb: vi.fn(),
}));

const createLibsqlSdkMock = vi.mocked(createLibsqlSdk);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);
const worldDbMock = vi.mocked(worldDb);

const dbFile = join(tmpdir(), "worlds-api-abuse-test.db");
const dbUrl = `file:${dbFile.replaceAll("\\", "/")}`;

const env = {
  LIBSQL_URL: dbUrl,
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
  databaseUrl: "file:test.db",
  databaseAuthToken: undefined,
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

beforeAll(async () => {
  rmSync(dbFile, { force: true });
  const client = createClient({ url: dbUrl });
  await client.batch(
    [
      "CREATE TABLE IF NOT EXISTS api_keys (uid TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', namespace TEXT NOT NULL, world_id TEXT, scopes TEXT NOT NULL DEFAULT '[\\\"data:read\\\",\\\"data:write\\\"]', create_time TEXT NOT NULL, revoked_at TEXT)",
    ],
    "write",
  );
  const readOnlyHash = await sha256Hex(READ_ONLY_TOKEN);
  await client.execute({
    sql: "INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      "key-read-only",
      readOnlyHash,
      "read-only key",
      "ns",
      null,
      '["data:read"]',
      new Date().toISOString(),
    ],
  });
  const fullHash = await sha256Hex(FULL_TOKEN);
  await client.execute({
    sql: "INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      "key-full",
      fullHash,
      "full key",
      "ns",
      null,
      '["data:read","data:write"]',
      new Date().toISOString(),
    ],
  });
  client.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveWorldDatabaseMock.mockResolvedValue(worldRef as never);
  worldDbMock.mockReturnValue({} as never);
  createLibsqlSdkMock.mockReturnValue({
    sparql: vi.fn().mockResolvedValue({ kind: "ask", data: { boolean: true } }),
    import: vi.fn().mockResolvedValue({}),
  } as never);
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
    const client = createLibsqlSdkMock.mock.results[0]?.value as {
      import: ReturnType<typeof vi.fn>;
    };
    expect(client?.import).not.toHaveBeenCalled();
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
    expect(createLibsqlSdkMock).not.toHaveBeenCalled();
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
    expect(createLibsqlSdkMock).not.toHaveBeenCalled();
  });

  it("allows a data:read key on a read route (sparql)", async () => {
    const res = await request(READ_ONLY_TOKEN, "/worlds/test-world/sparql", {
      method: "POST",
      body: JSON.stringify({ query: "SELECT * WHERE { ?s ?p ?o }" }),
    });
    expect(res.status).toBe(200);
  });
});
