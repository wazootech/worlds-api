import { describe, expect, it, vi } from "vitest";

// Mock the db module
vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uid: vi.fn(() => "test-uid"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

import { provisionWorld, resolveWorld } from "../src/lib/d1-provision";
import { execute, queryOne } from "../src/lib/db";

const env = { DB: {} as any } as any;

describe("provisionWorld", () => {
  it("inserts a new world with default values", async () => {
    const executeMock = vi.mocked(execute);
    const queryOneMock = vi.mocked(queryOne);

    executeMock.mockResolvedValue({ rowsAffected: 1 });
    queryOneMock.mockResolvedValue({
      world_id: "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      namespace: "ns",
      display_name: "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
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

    const result = await provisionWorld(
      env,
      "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      "ns",
    );
    expect(queryOneMock).toHaveBeenCalled();
    expect((queryOneMock as any).mock.calls[0][1]).toContain(
      "INSERT INTO worlds (world_id,",
    );
    expect(result.world_id).toBe("w_01jbz3k9x7c4m2q8r5t6v0w1yz");
    expect(result.namespace).toBe("ns");
    expect(result.state).toBe("active");
  });

  it("uses provided display name", async () => {
    const executeMock = vi.mocked(execute);
    const queryOneMock = vi.mocked(queryOne);

    executeMock.mockResolvedValue({ rowsAffected: 1 });
    queryOneMock.mockResolvedValue({
      world_id: "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      namespace: "ns",
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

    const result = await provisionWorld(
      env,
      "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      "ns",
      {
        displayName: "My World",
      },
    );
    expect(result.display_name).toBe("My World");
  });
});

describe("resolveWorld", () => {
  it("returns null for unknown world", async () => {
    const queryOneMock = vi.mocked(queryOne);
    queryOneMock.mockResolvedValue(null);

    const result = await resolveWorld(env, "w_unknown");
    expect(result).toBeNull();
  });

  it("returns world metadata for active world", async () => {
    const queryOneMock = vi.mocked(queryOne);
    queryOneMock.mockResolvedValue({
      world_id: "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      namespace: "ns",
      display_name: "Active World",
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

    const result = await resolveWorld(env, "w_01jbz3k9x7c4m2q8r5t6v0w1yz");
    expect(result?.world_id).toBe("w_01jbz3k9x7c4m2q8r5t6v0w1yz");
    expect(result?.state).toBe("active");
  });

  it("returns null when includeDeleted is false and world is deleted", async () => {
    const queryOneMock = vi.mocked(queryOne);
    queryOneMock.mockResolvedValue(null);

    const result = await resolveWorld(
      env,
      "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      false,
    );
    expect(result).toBeNull();
  });

  it("returns world when includeDeleted is true", async () => {
    const queryOneMock = vi.mocked(queryOne);
    queryOneMock.mockResolvedValue({
      world_id: "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      state: "deleted",
    });

    const result = await resolveWorld(
      env,
      "w_01jbz3k9x7c4m2q8r5t6v0w1yz",
      true,
    );
    expect(result?.world_id).toBe("w_01jbz3k9x7c4m2q8r5t6v0w1yz");
    expect(result?.state).toBe("deleted");
  });
});
