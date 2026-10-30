import { budgetActive, pending } from "./state";

type D1Database = import("@cloudflare/workers-types").D1Database;

type Statement = ReturnType<D1Database["prepare"]>;

function rowsWritten(result: unknown): number {
  const meta = (result as { meta?: { rows_written?: number } } | null)?.meta;
  return Number(meta?.rows_written ?? 0);
}

/**
 * meterDatabase wraps the D1 binding the data plane uses and adds up the
 * `meta.rows_written` of everything it executes (index writes included) under
 * the namespace. flushWriteUsage stores the totals.
 */
export function meterDatabase(db: D1Database, namespace: string): D1Database {
  const add = (rows: number) => {
    if (rows > 0 && budgetActive.get(namespace) !== false) {
      pending.set(namespace, (pending.get(namespace) ?? 0) + rows);
    }
  };
  const real = new WeakMap<object, Statement>();
  const wrap = (statement: Statement): Statement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      all: async () => {
        const result = await statement.all();
        add(rowsWritten(result));
        return result;
      },
      run: async () => {
        const result = await statement.run();
        add(rowsWritten(result));
        return result;
      },
      first: (...args: unknown[]) =>
        (statement.first as (...a: unknown[]) => unknown)(...args),
      raw: (...args: unknown[]) =>
        (statement.raw as (...a: unknown[]) => unknown)(...args),
    } as unknown as Statement;
    real.set(wrapped as object, statement);
    return wrapped;
  };
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: async (statements: Statement[]) => {
      const results = await db.batch(
        statements.map((s) => real.get(s as object) ?? s),
      );
      for (const result of results) add(rowsWritten(result));
      return results;
    },
    exec: (sql: string) => db.exec(sql),
    dump: () => db.dump(),
  } as unknown as D1Database;
}
