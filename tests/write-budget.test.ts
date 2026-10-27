import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";
import { resolveWorldDatabase, getWorldSdk } from "../src/lib/world-db";
import {
  flushWriteUsage,
  meterDatabase,
  resetPendingWriteUsage,
  namespaceWriteBudget,
  rowWriteBudget,
  rowsWrittenToday,
  setNamespaceWriteBudget,
  writeBudgetRefusal,
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

describe("writeBudgetRefusal", () => {
  const refused = async (env: any, ns = NS) =>
    (await writeBudgetRefusal(env, ns)) !== null;

  it("is null when the budget is off, whatever was written", async () => {
    const { database } = fakeDatabase(1_000_000);
    await meterDatabase(database, NS).prepare("INSERT ...").run();
    await flushWriteUsage(envWith());
    expect(await writeBudgetRefusal(envWith(), NS)).toBeNull();
  });

  it("refuses once the namespace has used the budget", async () => {
    const { database } = fakeDatabase(60);
    const metered = meterDatabase(database, NS);
    expect(await refused(envWith("100"))).toBe(false);
    await metered.prepare("INSERT ...").run();
    expect(await refused(envWith("100"))).toBe(false);
    await metered.prepare("INSERT ...").run();
    // Pending (unflushed) usage counts, so a burst cannot slip past.
    const refusal = await writeBudgetRefusal(envWith("100"), NS);
    expect(refusal?.error.code).toBe("WRITE_BUDGET_EXCEEDED");
    expect(refusal?.error.message).toContain("(100 rows)");
    // Another namespace is unaffected.
    expect(await refused(envWith("100"), "other")).toBe(false);
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
    expect(await refused(broken)).toBe(false);
  });
});

describe("per-namespace override", () => {
  const used = async (rows: number, ns = NS) => {
    const { database } = fakeDatabase(rows);
    await meterDatabase(database, ns).prepare("INSERT ...").run();
  };

  it("replaces the default for that namespace only", async () => {
    const env = envWith("1000");
    await setNamespaceWriteBudget(env, NS, 50);
    expect(await namespaceWriteBudget(env, NS)).toBe(50);
    expect(await namespaceWriteBudget(env, "other")).toBe(1000);
    await used(60);
    await used(60, "other");
    expect((await writeBudgetRefusal(env, NS))?.error.message).toContain(
      "(50 rows)",
    );
    expect(await writeBudgetRefusal(env, "other")).toBeNull();
  });

  it("turns the budget on for a namespace when there is no default", async () => {
    const env = envWith();
    expect(await namespaceWriteBudget(env, NS)).toBeNull();
    await setNamespaceWriteBudget(env, NS, 10);
    await used(20);
    expect(await writeBudgetRefusal(env, NS)).not.toBeNull();
    expect(await writeBudgetRefusal(env, "other")).toBeNull();
  });

  it("counts writes only while a budget applies, even through one metered database", async () => {
    const env = envWith();
    const { database } = fakeDatabase(10);
    // One database object, as a cached SDK holds it for its whole life.
    const metered = meterDatabase(database, NS);

    await namespaceWriteBudget(env, NS); // no budget: not counted
    await metered.prepare("INSERT ...").run();
    expect(await rowsWrittenToday(env, NS)).toBe(0);

    await setNamespaceWriteBudget(env, NS, 100);
    await namespaceWriteBudget(env, NS); // budget now applies
    await metered.prepare("INSERT ...").run();
    expect(await rowsWrittenToday(env, NS)).toBe(10);

    await setNamespaceWriteBudget(env, NS, null);
    await namespaceWriteBudget(env, NS); // cleared again
    await metered.prepare("INSERT ...").run();
    expect(await rowsWrittenToday(env, NS)).toBe(10);
  });

  it("falls back to the default when cleared, and sees changes at once", async () => {
    const env = envWith("1000");
    await setNamespaceWriteBudget(env, NS, 5);
    expect(await namespaceWriteBudget(env, NS)).toBe(5);
    await setNamespaceWriteBudget(env, NS, null);
    expect(await namespaceWriteBudget(env, NS)).toBe(1000);
    await setNamespaceWriteBudget(env, NS, 7);
    expect(await namespaceWriteBudget(env, NS)).toBe(7);
  });

  it("uses the default when the override cannot be read", async () => {
    const broken = {
      DB: {
        prepare() {
          throw new Error("D1 unavailable");
        },
      },
      NAMESPACE_DAILY_ROW_WRITE_BUDGET: "100",
    } as any;
    expect(await namespaceWriteBudget(broken, NS)).toBe(100);
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
