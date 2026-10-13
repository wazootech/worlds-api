import { createRequire } from "node:module";

/**
 * A real-SQLite D1 stand-in (node:sqlite) so tests exercise the actual SQL,
 * including upserts and the atomic budget reservation, instead of a mock.
 */
const require = createRequire(import.meta.url);

type Stmt = {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): { changes: number | bigint };
};

export function createSqliteD1() {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): Stmt;
      exec(sql: string): void;
    };
  };
  const db = new DatabaseSync(":memory:");

  function prepare(sql: string) {
    const make = (args: unknown[]): any => ({
      // Exposed so batch() can replay statements built by the real SDK.
      __sql: sql,
      __args: args,
      bind: (...values: unknown[]) => make(values),
      async all() {
        return {
          results: db.prepare(sql).all(...args),
          success: true,
          meta: {},
        };
      },
      async first() {
        return (db.prepare(sql).get(...args) as unknown) ?? null;
      },
      async run() {
        const result = db.prepare(sql).run(...args);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
    });
    return make([]);
  }

  return {
    prepare,
    async exec(sql: string) {
      db.exec(sql);
    },
    /**
     * Runs the statements in one transaction (D1 batch semantics: all or
     * nothing), so the real @worlds/cloudflare SDK can run against this shim.
     */
    async batch(statements: Array<{ __sql: string; __args: unknown[] }>) {
      const results: unknown[] = [];
      db.exec("BEGIN");
      try {
        for (const statement of statements) {
          const result = db
            .prepare(statement.__sql)
            .run(...(statement.__args as never[]));
          results.push({
            success: true,
            results: [],
            meta: { changes: Number(result.changes) },
          });
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return results;
    },
    /** Test-only raw access. */
    raw: db,
  };
}

export type SqliteD1 = ReturnType<typeof createSqliteD1>;
