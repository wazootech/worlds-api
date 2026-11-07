import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { resolveWorldDatabase } from "../src/lib/world-db";
import { flushWriteUsage } from "../src/lib/write-budget";
import {
  envWith,
  fakeDatabase,
  NS,
  useBudgetDb,
} from "./helpers/write-budget-harness";

const mocks = vi.hoisted(() => ({ backfillInference: vi.fn() }));
vi.mock("@worlds/cloudflare", () => ({
  backfillInference: mocks.backfillInference,
}));
vi.mock("../src/lib/world-db", () => ({
  clearSdkCacheForWorld: vi.fn(),
  getWorldSdk: vi.fn(),
  resolveWorldDatabase: vi.fn(),
}));

useBudgetDb();

const worldId = "w_00000000000000000000000001";
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** Control-plane D1 whose back-fill statements report `rows` rows written. */
function envWithBackfillRows(rows: number) {
  const env = envWith("100");
  const control = env.DB;
  const fake = fakeDatabase(rows).database;
  env.DB = {
    prepare: (sql: string) =>
      sql.startsWith("BACKFILL") ? fake.prepare(sql) : control.prepare(sql),
    batch: (s: unknown[]) => control.batch(s),
  };
  return env;
}

const post = (env: object) =>
  app.request(
    `/worlds/${worldId}/infer`,
    { method: "POST", headers: { Authorization: "Bearer admin-token" } },
    env,
    ctx,
  );

beforeEach(() => {
  vi.mocked(resolveWorldDatabase).mockResolvedValue({
    worldId,
    namespace: NS,
    embeddingModel: "use",
    chunkSize: 1000,
    topK: 5,
    minScore: 0.5,
    inference: { enabled: true, maxAssertedQuads: 500 },
  } as never);
  mocks.backfillInference.mockImplementation(
    async (opts: { database: ReturnType<typeof fakeDatabase>["database"] }) => {
      await opts.database.prepare("BACKFILL insert").run();
      return {
        assertedQuads: 1,
        derivedWritten: 1,
        derivedRemoved: 0,
        inconsistencies: [],
      };
    },
  );
});

describe("POST /worlds/:worldId/infer write budget", () => {
  it("counts back-fill rows toward the namespace budget and then refuses", async () => {
    const env = envWithBackfillRows(150);
    expect((await post(env)).status).toBe(200);
    await flushWriteUsage(env);
    const row = await env.DB.prepare(
      "SELECT rows_written FROM namespace_write_usage WHERE namespace = ?",
    )
      .bind(NS)
      .first();
    expect(row).toMatchObject({ rows_written: 150 });

    const again = await post(env);
    expect(again.status).toBe(429);
    expect(((await again.json()) as any).error.code).toBe(
      "WRITE_BUDGET_EXCEEDED",
    );
  });
});
