import { beforeEach, vi } from "vitest";
import { CONTROL_PLANE_DDL } from "../../src/lib/d1-schema";
import { resetPendingWriteUsage } from "../../src/lib/write-budget";
import { createSqliteD1, type SqliteD1 } from "./sqlite-d1";

export const NS = "ns1";
let db: SqliteD1;

/** Registers the per-test hook that builds a fresh control-plane database. */
export function useBudgetDb() {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetPendingWriteUsage();
    db = createSqliteD1();
    for (const ddl of CONTROL_PLANE_DDL) await db.prepare(ddl).run();
  });
}

export const envWith = (budget?: string) =>
  ({
    DB: db,
    NAMESPACE_DAILY_ROW_WRITE_BUDGET: budget,
    WORLDS_API_ADMIN_KEY: "admin-token",
    RATE_LIMIT_RPM: "0",
  }) as any;

/** A fake D1 binding whose every write reports `rows` rows written. */
export function fakeDatabase(rows: number) {
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
