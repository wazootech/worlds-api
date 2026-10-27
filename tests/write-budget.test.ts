import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";
import { resolveWorldDatabase, getWorldSdk } from "../src/lib/world-db";
import {
  flushWriteUsage,
  meterDatabase,
  resetPendingWriteUsage,
  rowWriteBudget,
  rowsWrittenToday,
  writeBudgetExceeded,
} from "../src/lib/write-budget";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";

vi.mock("../src/lib/world-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/world-db")>()),
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));

const NS = "ns1";
let db: SqliteD1;

beforeEach(async () => {
  vi.clearAllMocks();
  resetPendingWriteUsage();
  db = createSqliteD1();
  for (const ddl of CONTROL_PLANE_DDL) await db.prepare(ddl).run();
});

const envWith = (budget?: string) =>
  ({
    DB: db,
    NAMESPACE_DAILY_ROW_WRITE_BUDGET: budget,
    WORLDS_API_ADMIN_KEY: "admin-token",
    RATE_LIMIT_RPM: "0",
  }) as any;

/** A fake D1 binding whose every write reports `rows` rows written. */
function fakeDatabase(rows: number) {
  const result = { results: [], success: true, meta: { rows_written: rows } };
  const statement: any = {
    bind: () => statement,
    all: async () => result,
    run: async () => result,
    first: async () => null,
    raw: async () => [],
  };
  const batchSeen: unknown[][] = [];
  return {
    database: {
      prepare: () => statement,
      batch: async (statements: unknown[]) => {
        batchSeen.push(statements);
        return statements.map(() => result);
      },
      exec: async () => undefined,
      dump: async () => new ArrayBuffer(0),
    } as any,
    statement,
    batchSeen,
  };
}

describe("rowWriteBudget", () => {
  it("is off unless a positive integer is configured", () => {
    expect(rowWriteBudget(envWith())).toBeNull();
    expect(rowWriteBudget(envWith("0"))).toBeNull();
    expect(rowWriteBudget(envWith("abc"))).toBeNull();
    expect(rowWriteBudget(envWith("-5"))).toBeNull();
    expect(rowWriteBudget(envWith("2.5"))).toBeNull();
    expect(rowWriteBudget(envWith("5000"))).toBe(5000);
  });
});

describe("meterDatabase and the stored usage", () => {
  it("adds up rows written by run, all and batch, then stores them", async () => {
    const { database, statement } = fakeDatabase(7);
    const metered = meterDatabase(database, NS);

    await metered.prepare("INSERT ...").bind(1).run();
    await metered.prepare("SELECT ...").all();
    // The batch must receive the real statements, not the wrappers.
    const wrapped = metered.prepare("INSERT ...");
    const batched = await metered.batch([wrapped, wrapped]);
    expect(batched).toHaveLength(2);
    expect(await rowsWrittenToday(envWith("100"), NS)).toBe(7 + 7 + 14);

    await flushWriteUsage(envWith("100"));
    await flushWriteUsage(envWith("100"));
    // Stored once, and pending is cleared so a second flush adds nothing.
    expect(await rowsWrittenToday(envWith("100"), NS)).toBe(28);
    expect(statement).toBeDefined();
  });

  it("accumulates across flushes for the same namespace and day", async () => {
    const { database } = fakeDatabase(10);
    const metered = meterDatabase(database, NS);
    await metered.prepare("INSERT ...").run();
    await flushWriteUsage(envWith("100"));
    await metered.prepare("INSERT ...").run();
    await flushWriteUsage(envWith("100"));
    expect(await rowsWrittenToday(envWith("100"), NS)).toBe(20);
  });

  it("counts namespaces separately", async () => {
    const { database } = fakeDatabase(10);
    await meterDatabase(database, "a").prepare("INSERT ...").run();
    await meterDatabase(database, "b").prepare("INSERT ...").run();
    await meterDatabase(database, "b").prepare("INSERT ...").run();
    await flushWriteUsage(envWith("100"));
    expect(await rowsWrittenToday(envWith("100"), "a")).toBe(10);
    expect(await rowsWrittenToday(envWith("100"), "b")).toBe(20);
  });
});

describe("writeBudgetExceeded", () => {
  it("is false when the budget is off, whatever was written", async () => {
    const { database } = fakeDatabase(1_000_000);
    await meterDatabase(database, NS).prepare("INSERT ...").run();
    await flushWriteUsage(envWith());
    expect(await writeBudgetExceeded(envWith(), NS)).toBe(false);
  });

  it("turns true once the namespace has used the budget", async () => {
    const { database } = fakeDatabase(60);
    const metered = meterDatabase(database, NS);
    expect(await writeBudgetExceeded(envWith("100"), NS)).toBe(false);
    await metered.prepare("INSERT ...").run();
    expect(await writeBudgetExceeded(envWith("100"), NS)).toBe(false);
    await metered.prepare("INSERT ...").run();
    // Pending (unflushed) usage counts, so a burst cannot slip past.
    expect(await writeBudgetExceeded(envWith("100"), NS)).toBe(true);
    // Another namespace is unaffected.
    expect(await writeBudgetExceeded(envWith("100"), "other")).toBe(false);
  });

  it("fails open when the usage cannot be read", async () => {
    const broken = {
      DB: {
        prepare() {
          throw new Error("D1 unavailable");
        },
      },
      NAMESPACE_DAILY_ROW_WRITE_BUDGET: "100",
    } as any;
    expect(await writeBudgetExceeded(broken, NS)).toBe(false);
  });
});

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
