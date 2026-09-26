import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Env } from "../src/env";

vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  randomUuid: vi.fn(() => "api-key-existing"),
  now: vi.fn(() => "2026-09-01T00:00:00.000Z"),
}));

import { execute, getDb, query } from "../src/lib/db";

const db = {
  prepare: () => ({
    bind: () => ({
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ results: [], meta: { changes: 1 } }),
    }),
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ results: [], meta: { changes: 1 } }),
  }),
} as never;

const env = {
  DB: db,
  WORLDS_ADMIN_KEY: "admin-key",
  WAZOO_ENV: "test",
  RATE_LIMIT_RPM: "0",
} as unknown as Env;

function adminRequest(path: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        authorization: "Bearer admin-key",
        "content-type": "application/json",
        ...(init.headers as Record<string, string>),
      },
    },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(query).mockResolvedValue([]);
  vi.mocked(execute).mockResolvedValue({ rowsAffected: 1 });
});

describe("API key identifiers", () => {
  it("creates keys with apiKeyId and worldId", async () => {
    const response = await adminRequest("/api-keys", {
      method: "POST",
      body: JSON.stringify({
        namespace: "account-existing",
        worldId: "w-existing",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      apiKeyId: "api-key-existing",
      worldId: "w-existing",
    });
    expect(body).not.toHaveProperty("uid");
    expect(execute).toHaveBeenCalledWith(
      db,
      expect.stringContaining("INSERT INTO api_keys (api_key_id"),
      expect.arrayContaining(["api-key-existing"]),
    );
  });

  it("lists keys with apiKeyId and worldId without exposing storage names", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        api_key_id: "api-key-existing",
        name: "Read key",
        namespace: "account-existing",
        world_id: "w-existing",
        scopes: '["data:read"]',
        create_time: "2026-09-01T00:00:00.000Z",
      },
    ]);

    const response = await adminRequest("/api-keys");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.keys[0]).toMatchObject({
      apiKeyId: "api-key-existing",
      worldId: "w-existing",
    });
    expect(body.keys[0]).not.toHaveProperty("uid");
    expect(body.keys[0]).not.toHaveProperty("api_key_id");
  });

  it("revokes by apiKeyId", async () => {
    const response = await adminRequest("/api-keys/api-key-existing", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(execute).toHaveBeenCalledWith(
      db,
      expect.stringContaining("WHERE api_key_id = ?"),
      ["2026-09-01T00:00:00.000Z", "api-key-existing"],
    );
  });
});
