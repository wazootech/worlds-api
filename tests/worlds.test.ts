import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { provisionWorld } from "../src/lib/d1-provision";
import { getWorldSdk, resolveWorldDatabase } from "../src/lib/world-db";
import { sha256Hex } from "../src/lib/crypto";

vi.mock("../src/lib/d1-provision", () => ({
  provisionWorld: vi.fn(),
}));

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uid: vi.fn(() => "test-uid"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

const provisionMock = vi.mocked(provisionWorld);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);
const getWorldSdkMock = vi.mocked(getWorldSdk);

import { getDb, query, queryOne, execute } from "../src/lib/db";
const getDbMock = vi.mocked(getDb);
const queryMock = vi.mocked(query);
const queryOneMock = vi.mocked(queryOne);
const executeMock = vi.mocked(execute);

const env = {
  DB: {} as any,
  WORLDS_ADMIN_KEY: "test-admin-key",
  WAZOO_ENV: "test",
  RATE_LIMIT_RPM: "0",
} as unknown as Env;

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const ADMIN_KEY = "test-admin-key";
const USER_TOKEN = "test-user-token";

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

function adminRequest(path: string, init: RequestInit = {}) {
  return request(ADMIN_KEY, path, init);
}

function userRequest(path: string, init: RequestInit = {}) {
  return request(USER_TOKEN, path, init);
}

let userTokenHash = "";

beforeAll(async () => {
  userTokenHash = await sha256Hex(USER_TOKEN);
});

beforeEach(() => {
  vi.clearAllMocks();

  // Create a mock D1 that intercepts prepare().bind().all() for auth queries
  const apiKeyRows: Record<string, any> = {};
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

  // Register API key for USER_TOKEN
  apiKeyRows[userTokenHash] = {
    namespace: "user-1",
    world_id: null,
    scopes: '["data:read","data:write"]',
  };

  // Mock world resolution for data-plane routes
  resolveWorldDatabaseMock.mockResolvedValue(null);

  // Mock SDK
  getWorldSdkMock.mockResolvedValue({
    sparql: vi.fn().mockResolvedValue({ kind: "ask", data: { boolean: true } }),
    import: vi.fn().mockResolvedValue({}),
  } as never);

  // Default: world list returns empty
  queryMock.mockResolvedValue([]);

  // Default: execute succeeds
  executeMock.mockResolvedValue({ rowsAffected: 1 });
});

describe("world lifecycle", () => {
  it("rejects create without authorization", async () => {
    const res = await request(null, "/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "X" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects list without authorization", async () => {
    const res = await request(null, "/worlds");
    expect(res.status).toBe(401);
  });

  it("rejects admin create without a namespace-scoped key", async () => {
    const res = await adminRequest("/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "X" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("creates a world with a server-minted world_uid", async () => {
    provisionMock.mockResolvedValue({
      uid: "w_test-uid",
      namespace: "user-1",
      display_name: "My World",
      state: "active",
      embedding_model: "tfjs-universal-sentence-encoder",
      chunk_size: 1000,
      top_k: 20,
      min_score: 0.0,
      delete_time: null,
      expire_time: null,
      purge_status: "none",
      purged_at: null,
      create_time: "2026-01-01T00:00:00.000Z",
      update_time: "2026-01-01T00:00:00.000Z",
    });

    const res = await userRequest("/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "My World" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.uid).toMatch(/^w_/);
    expect(body.name).toBe(`worlds/${body.uid}`);
    expect(body.displayName).toBe("My World");
    expect(body.storage).toBe("d1");
    expect(provisionMock).toHaveBeenCalled();
  });

  it("rejects get for a missing world", async () => {
    queryOneMock.mockResolvedValue(null);
    const res = await adminRequest("/worlds/w_nope");
    expect(res.status).toBe(404);
  });

  it("rejects admin purge without an admin key", async () => {
    const res = await request(null, "/admin/purge", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("runs the purge sweep for an admin key", async () => {
    queryMock.mockResolvedValue([]);
    const res = await adminRequest("/admin/purge", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purged).toBe(0);
    expect(body.failed).toBe(0);
  });

  it("rejects namespace delete without an admin key", async () => {
    const res = await request(null, "/admin/namespaces/user-delete/delete", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});
