import { createClient } from "@libsql/client";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { provisionWorldDatabase, destroyWorldDatabase } from "../src/lib/turso";
import { initializeWorldDatabase } from "../src/lib/world-db";
import { sha256Hex } from "../src/lib/crypto";

vi.mock("../src/lib/turso", () => ({
  provisionWorldDatabase: vi.fn(),
  destroyWorldDatabase: vi.fn(),
}));

vi.mock("../src/lib/world-db", () => ({
  initializeWorldDatabase: vi.fn(),
}));

const provisionMock = vi.mocked(provisionWorldDatabase);
const destroyMock = vi.mocked(destroyWorldDatabase);
const initMock = vi.mocked(initializeWorldDatabase);

const dbFile = join(tmpdir(), "worlds-api-lifecycle-test.db");
const dbUrl = `file:${dbFile.replaceAll("\\", "/")}`;
const env = {
  LIBSQL_URL: dbUrl,
  WORLDS_ADMIN_KEY: "test-admin-key",
  TURSO_ORG: "test-org",
  TURSO_GROUP: "test-group",
  TURSO_PLATFORM_API_TOKEN: "test-token",
  WAZOO_ENV: "test",
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

beforeAll(async () => {
  rmSync(dbFile, { force: true });
  const client = createClient({ url: dbUrl });
  await client.batch(
    [
      "CREATE TABLE IF NOT EXISTS worlds_metadata (uid TEXT PRIMARY KEY, namespace TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'active', database_url TEXT, database_auth_token TEXT, embedding_model TEXT NOT NULL DEFAULT 'tfjs-universal-sentence-encoder', chunk_size INTEGER NOT NULL DEFAULT 1000, top_k INTEGER NOT NULL DEFAULT 20, min_score REAL NOT NULL DEFAULT 0.0, delete_time TEXT, expire_time TEXT, purge_status TEXT NOT NULL DEFAULT 'none', purged_at TEXT, create_time TEXT NOT NULL, update_time TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS api_keys (uid TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', namespace TEXT NOT NULL, world_id TEXT, scopes TEXT NOT NULL DEFAULT '[\"data:read\",\"data:write\"]', create_time TEXT NOT NULL, revoked_at TEXT)",
    ],
    "write",
  );
  const hash = await sha256Hex(USER_TOKEN);
  await client.execute({
    sql: "INSERT INTO api_keys (uid, key_hash, name, namespace, world_id, scopes, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      "key-user-1",
      hash,
      "user-1 key",
      "user-1",
      null,
      '["data:read","data:write"]',
      new Date().toISOString(),
    ],
  });
  client.close();
});

describe("world lifecycle (world_uid contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provisionMock.mockResolvedValue({
      name: "wz-test-w_x",
      url: "file:unused.db",
      authToken: "t",
    } as never);
    destroyMock.mockResolvedValue(undefined as never);
    initMock.mockResolvedValue(undefined as never);
  });

  it("rejects create without authorization", async () => {
    const res = await request(null, "/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "X" }),
    });
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
    const res = await userRequest("/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "My World" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.uid).toMatch(/^w_/);
    expect(body.name).toBe(`worlds/${body.uid}`);
    expect(body.displayName).toBe("My World");
    expect(body.storage).toBe("libsql-per-world");
    expect(body.namespace).toBeUndefined();
    expect(body.worldId).toBeUndefined();
  });

  it("destroys the provisioned database when schema init fails (no orphan)", async () => {
    initMock.mockRejectedValue(new Error("schema init boom"));
    const res = await userRequest("/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "Rollback World" }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("PROVISIONING_FAILED");
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledWith(expect.anything(), "wz-test-w_x");
  });

  it("rejects get for a missing world", async () => {
    const res = await adminRequest("/worlds/w_nope");
    expect(res.status).toBe(404);
  });

  it("rejects admin purge without an admin key", async () => {
    const res = await request(null, "/admin/purge", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("runs the purge sweep for an admin key", async () => {
    const res = await adminRequest("/admin/purge", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.purged).toBe("number");
  });
});
