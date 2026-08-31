/**
 * Minimal D1 mock for vitest tests. Stores data in memory using Maps.
 */

type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta: { changes: number };
};

class MockD1PreparedStatement {
  private boundArgs: unknown[] = [];

  constructor(
    private store: Map<string, unknown[]>,
    private sql: string,
    private allRows: Map<string, Record<string, unknown>[]>,
  ) {}

  bind(...values: unknown[]): MockD1PreparedStatement {
    const stmt = new MockD1PreparedStatement(this.store, this.sql, this.allRows);
    stmt.boundArgs = [...values];
    return stmt;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    // Simple mock: return empty results
    return { results: [] as T[], success: true, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }

  async run(): Promise<D1Result> {
    return { results: [], success: true, meta: { changes: 1 } };
  }
}

export class MockD1Database {
  private tables = new Map<string, Record<string, unknown>[]>();

  prepare(sql: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(
      new Map(),
      sql,
      this.tables,
    );
  }

  batch(_statements: unknown[]): Promise<unknown[]> {
    return Promise.resolve([]);
  }

  async exec(_sql: string): Promise<void> {
    // no-op for DDL in tests
  }
}

export function createMockD1Env() {
  const db = new MockD1Database();
  return {
    DB: db as any,
    WORLDS_ADMIN_KEY: "test-admin-key",
    WAZOO_ENV: "test",
    RATE_LIMIT_RPM: "6000",
    RATE_LIMIT_BURST: "1000",
    MAX_IMPORT_QUADS: "10",
    MAX_IMPORT_BYTES: "1048576",
    SPARQL_MAX_QUERY_LENGTH: "100",
    SPARQL_MAX_RESULTS: "10",
  };
}
