import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { resolveWorldDatabase, getWorldSdk } from "../src/lib/world-db";
import { flushWriteUsage, meterDatabase } from "../src/lib/write-budget";
import {
  envWith,
  fakeDatabase,
  NS,
  useBudgetDb,
} from "./helpers/write-budget-harness";

vi.mock("../src/lib/world-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/world-db")>()),
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));

useBudgetDb();

describe("routes", () => {
  const worldId = "w_00000000000000000000000001";
  const ref = {
    worldId,
    namespace: NS,
    embeddingModel: "use",
    chunkSize: 1000,
    topK: 5,
    minScore: 0.5,
  };
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const sparql = vi.fn();

  const post = (path: string, body: unknown, env: any) =>
    app.request(
      `/worlds/${worldId}/${path}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      env,
      ctx,
    );

  async function exhaust(env: any) {
    const { database } = fakeDatabase(500);
    await meterDatabase(database, NS).prepare("INSERT ...").run();
    await flushWriteUsage(env);
  }

  beforeEach(() => {
    vi.mocked(resolveWorldDatabase).mockResolvedValue(ref as never);
    sparql.mockReset();
    sparql.mockResolvedValue({ kind: "void" });
    vi.mocked(getWorldSdk).mockResolvedValue({ sparql } as never);
  });

  it("refuses a SPARQL update with 429 once the budget is used", async () => {
    const env = envWith("100");
    await exhaust(env);
    const res = await post("sparql", { query: "INSERT DATA {}" }, env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe(
      "WRITE_BUDGET_EXCEEDED",
    );
    expect(sparql).not.toHaveBeenCalled();
  });

  it("still serves reads when the budget is used", async () => {
    const env = envWith("100");
    await exhaust(env);
    sparql.mockResolvedValue({
      kind: "ask",
      data: { head: {}, boolean: true },
    });
    const res = await post("sparql", { query: "ASK { ?s ?p ?o }" }, env);
    expect(res.status).toBe(200);
    expect(sparql).toHaveBeenCalledTimes(1);
  });

  it("allows updates when the budget is off", async () => {
    const env = envWith();
    await exhaust(env);
    const res = await post("sparql", { query: "INSERT DATA {}" }, env);
    expect(res.status).toBe(200);
  });

  it("refuses an import with 429 once the budget is used", async () => {
    const env = envWith("100");
    await exhaust(env);
    const res = await post(
      "import",
      { data: "<urn:a> <urn:b> <urn:c> .", contentType: "text/turtle" },
      env,
    );
    expect(res.status).toBe(429);
    expect(getWorldSdk).not.toHaveBeenCalled();
  });
});

describe("admin routes", () => {
  const env = () => envWith("1000");
  const call = (
    method: string,
    body?: unknown,
    token = "admin-token",
    ns = NS,
  ) =>
    app.request(
      `/admin/namespaces/${ns}/write-budget`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env(),
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as unknown as ExecutionContext,
    );

  it("reports the default, then the override, then the default again", async () => {
    let res = await call("GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      namespace: NS,
      dailyRows: null,
      defaultDailyRows: 1000,
      effectiveDailyRows: 1000,
      rowsWrittenToday: 0,
    });

    res = await call("PUT", { dailyRows: 250 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      dailyRows: 250,
      effectiveDailyRows: 250,
    });

    res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      dailyRows: null,
      effectiveDailyRows: 1000,
    });
    // Clearing again is idempotent.
    expect((await call("DELETE")).status).toBe(200);
  });

  it("shows today's usage against the budget", async () => {
    const { database } = fakeDatabase(40);
    await meterDatabase(database, NS).prepare("INSERT ...").run();
    await flushWriteUsage(env());
    const body = (await (await call("GET")).json()) as any;
    expect(body.rowsWrittenToday).toBe(40);
  });

  it("rejects invalid budgets", async () => {
    for (const dailyRows of [0, -5, 2.5, "100", null, 2_000_000_000]) {
      const res = await call("PUT", { dailyRows });
      expect(res.status, JSON.stringify(dailyRows)).toBe(400);
    }
  });

  it("is admin-only", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await call(
        method,
        method === "PUT" ? { dailyRows: 5 } : undefined,
        "not-the-admin-key",
      );
      expect([401, 403], method).toContain(res.status);
    }
  });
});
