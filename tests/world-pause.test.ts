import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";
import { getDb, queryOne, execute, now } from "../src/lib/db";
import { resolveWorldDatabase } from "../src/lib/world-db";
import { runPauseSweep } from "../src/lib/pause";
import { sha256Hex } from "../src/lib/crypto";
import { createApiKeyDb } from "./helpers/api-key-db";
import { readJson, type ErrorBody } from "./helpers/json";

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
  clearSdkCacheForWorld: vi.fn(),
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

const WORLD_ID = "w_00000000000000000000000001";

const getDbMock = vi.mocked(getDb);
const queryOneMock = vi.mocked(queryOne);
const executeMock = vi.mocked(execute);
const nowMock = vi.mocked(now);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);

const env = {
  DB: {} as any,
  WORLDS_API_ADMIN_KEY: "test-admin-key",
  WAZOO_ENV: "test",
  RATE_LIMIT_RPM: "0",
} as unknown as Env;

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const ADMIN_KEY = "test-admin-key";
const OWN_WORLD_TOKEN = "own-world-token";
const OTHER_NAMESPACE_TOKEN = "other-namespace-token";

interface WorldBody {
  id: string;
  state: string;
  pauseUntil?: string;
}

function request(token: string | null, path: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
    },
    env,
    executionCtx,
  );
}

let ownTokenHash = "";
let otherTokenHash = "";

beforeAll(async () => {
  ownTokenHash = await sha256Hex(OWN_WORLD_TOKEN);
  otherTokenHash = await sha256Hex(OTHER_NAMESPACE_TOKEN);
});

function worldRow(state: string) {
  return {
    world_id: WORLD_ID,
    namespace: "user-1",
    display_name: "My World",
    state,
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const apiKeyRows: Record<string, any> = {};
  getDbMock.mockReturnValue(createApiKeyDb(apiKeyRows));
  apiKeyRows[ownTokenHash] = {
    namespace: "user-1",
    world_id: WORLD_ID,
    scopes: '["data:read","data:write"]',
  };
  apiKeyRows[otherTokenHash] = {
    namespace: "user-2",
    world_id: null,
    scopes: '["data:read","data:write"]',
  };
  resolveWorldDatabaseMock.mockResolvedValue(null);
  executeMock.mockResolvedValue({ rowsAffected: 1 });
  nowMock.mockReturnValue("2026-01-01T00:00:00.000Z");
  queryOneMock.mockResolvedValue(worldRow("active"));
});

describe("pause vs suspend permission classes (wazoo-api#22)", () => {
  it("rejects a non-admin key on suspend: suspension is control-plane only", async () => {
    const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}/suspend`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    const body = await readJson<ErrorBody>(res);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("suspends with the admin key and confirms the write", async () => {
    const res = await request(ADMIN_KEY, `/worlds/${WORLD_ID}/suspend`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    // Two awaited writes: the state flip, then retiring any pause deadline.
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0][1]).toContain("state = 'suspended'");
    expect(executeMock.mock.calls[1][1]).toContain(
      "DELETE FROM world_pause_state",
    );
    expect(queryOneMock).toHaveBeenCalled();
  });

  it("requires a duration to pause", async () => {
    const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}/pause`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects pause durations outside the 60s-30d window", async () => {
    for (const durationSeconds of [59, 30 * 24 * 60 * 60 + 1]) {
      const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}/pause`, {
        method: "POST",
        body: JSON.stringify({ durationSeconds }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("pauses with a mandatory time limit and reports the deadline", async () => {
    queryOneMock
      .mockResolvedValueOnce(worldRow("active"))
      .mockResolvedValue(worldRow("paused"));
    const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}/pause`, {
      method: "POST",
      body: JSON.stringify({ durationSeconds: 3600 }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<WorldBody>(res);
    expect(body.state).toBe("paused");
    expect(body.pauseUntil).toBe("2026-01-01T01:00:00.000Z");
    // Two awaited writes: the state flip and the pause deadline row.
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0][1]).toContain("state = 'paused'");
    expect(executeMock.mock.calls[1][1]).toContain(
      "INSERT INTO world_pause_state",
    );
    expect(executeMock.mock.calls[1][2]).toContain("2026-01-01T01:00:00.000Z");
  });

  it("rejects a pause from another namespace", async () => {
    queryOneMock.mockResolvedValue(worldRow("active"));
    const res = await request(
      OTHER_NAMESPACE_TOKEN,
      `/worlds/${WORLD_ID}/pause`,
      {
        method: "POST",
        body: JSON.stringify({ durationSeconds: 3600 }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("lets the owning key resume its own paused world early", async () => {
    queryOneMock
      .mockResolvedValueOnce(worldRow("paused"))
      .mockResolvedValue(worldRow("active"));
    const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}/resume`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await readJson<WorldBody>(res);
    expect(body.state).toBe("active");
  });

  it("forbids a non-admin key from resuming a suspended world", async () => {
    queryOneMock.mockResolvedValue(worldRow("suspended"));
    const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}/resume`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("lets the admin resume a suspended world", async () => {
    queryOneMock
      .mockResolvedValueOnce(worldRow("suspended"))
      .mockResolvedValue(worldRow("active"));
    const res = await request(ADMIN_KEY, `/worlds/${WORLD_ID}/resume`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await readJson<WorldBody>(res);
    expect(body.state).toBe("active");
  });

  it("rejects a non-admin state transition through PATCH", async () => {
    const res = await request(OWN_WORLD_TOKEN, `/worlds/${WORLD_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "suspended" }),
    });
    expect(res.status).toBe(403);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("accepts an admin state transition through PATCH", async () => {
    queryOneMock
      .mockResolvedValueOnce(worldRow("active"))
      .mockResolvedValue(worldRow("suspended"));
    const res = await request(ADMIN_KEY, `/worlds/${WORLD_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "suspended" }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<WorldBody>(res);
    expect(body.state).toBe("suspended");
    expect(executeMock.mock.calls[0][1]).toContain("state = ?");
  });
});

describe("pause enforcement and auto-resume", () => {
  it("resolves with a pause-aware query driven by the current time", async () => {
    // The real resolveWorldDatabase over the mocked db layer: the SQL must
    // gate on both the state and the pause deadline, with now() as the
    // comparison point (lazy auto-resume).
    const actual = await vi.importActual<typeof import("../src/lib/world-db")>(
      "../src/lib/world-db",
    );
    let capturedSql = "";
    let capturedArgs: unknown[] = [];
    queryOneMock.mockImplementation(async (_db, sql, args) => {
      capturedSql = sql as string;
      capturedArgs = args ?? [];
      return null;
    });
    const ref = await actual.resolveWorldDatabase(env, WORLD_ID);
    expect(ref).toBeNull();
    expect(capturedSql).toContain("state = 'active'");
    expect(capturedSql).toContain("world_pause_state");
    expect(capturedSql).toContain("p.pause_until > ?");
    expect(capturedArgs).toHaveLength(2);
    expect(capturedArgs[1]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("sweeps expired pauses back to active and drops their deadlines", async () => {
    const resumed = await runPauseSweep(env);
    expect(resumed).toBe(1);
    expect(executeMock.mock.calls[0][1]).toContain("state = 'active'");
    expect(executeMock.mock.calls[0][1]).toContain("state = 'paused'");
    expect(executeMock.mock.calls[1][1]).toContain(
      "DELETE FROM world_pause_state",
    );
  });
});
