import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { provisionWorld } from "../src/lib/d1-provision";
import { sha256Hex } from "../src/lib/crypto";
import { createApiKeyDb } from "./helpers/api-key-db";
import { readJson, type ErrorBody } from "./helpers/json";

vi.mock("../src/lib/d1-provision", () => ({ provisionWorld: vi.fn() }));
vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));
vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uid: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
  newWorldId: vi.fn(() => "w_00000000000000000000000001"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

import { getDb, query } from "../src/lib/db";

const env = {
  DB: {} as unknown,
  WORLDS_API_ADMIN_KEY: "test-admin-key",
  WAZOO_ENV: "test",
  RATE_LIMIT_RPM: "0",
} as unknown as Env;
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const NAMESPACE_TOKEN = "fixture-namespace-token";
const WORLD_TOKEN = "fixture-world-token";
const SCOPES = '["data:read","data:write"]';

let namespaceHash = "";
let worldHash = "";

function request(token: string, path: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    },
    env,
    executionCtx,
  );
}

beforeAll(async () => {
  namespaceHash = await sha256Hex(NAMESPACE_TOKEN);
  worldHash = await sha256Hex(WORLD_TOKEN);
});

beforeEach(() => {
  vi.clearAllMocks();
  const rows: Record<string, unknown> = {
    [namespaceHash]: { namespace: "user-1", world_id: null, scopes: SCOPES },
    [worldHash]: {
      namespace: "user-1",
      world_id: "w_00000000000000000000000002",
      scopes: SCOPES,
    },
  };
  vi.mocked(getDb).mockReturnValue(createApiKeyDb(rows as never));
  vi.mocked(query).mockResolvedValue([]);
});

describe("world-scoped keys on namespace-level routes", () => {
  it("rejects POST /worlds without provisioning", async () => {
    const res = await request(WORLD_TOKEN, "/worlds", {
      method: "POST",
      body: JSON.stringify({ displayName: "X" }),
    });
    expect(res.status).toBe(403);
    expect((await readJson<ErrorBody>(res)).error.code).toBe("FORBIDDEN");
    expect(provisionWorld).not.toHaveBeenCalled();
  });

  it("rejects GET /worlds without listing sibling worlds", async () => {
    const res = await request(WORLD_TOKEN, "/worlds");
    expect(res.status).toBe(403);
    expect((await readJson<ErrorBody>(res)).error.code).toBe("FORBIDDEN");
    expect(query).not.toHaveBeenCalled();
  });

  it("still lets a namespace-wide key list worlds", async () => {
    const res = await request(NAMESPACE_TOKEN, "/worlds");
    expect(res.status).toBe(200);
  });
});
