/**
 * WorldScopedD1 wraps a D1Database to inject `world_uid` filtering.
 *
 * @worlds/cloudflare's D1RdfjsStore has no concept of per-world scoping — it
 * operates on a single D1 database. This wrapper intercepts `prepare()` to
 * rewrite SQL so that:
 *
 * - INSERT INTO quads/chunks gets an extra `world_uid` column + binding
 * - SELECT/UPDATE/DELETE on quads/chunks gets `AND world_uid = ?` appended
 * - DDL and unrelated tables pass through unchanged
 *
 * The real D1 prepared statement receives the rewritten SQL. The caller's
 * `bind()` call must include the world_uid value as the last argument — this
 * is handled by WorldScopedStatement which auto-appends it.
 */

// NOTE: chunks_fts is intentionally excluded. It's an FTS5 virtual table
// with only (rowid, fts_value) — it cannot have a world_uid column.
// Data is already world-scoped because:
//  1. chunks rows are inserted with world_uid (via rewriteInsert)
//  2. chunks_fts is populated by INSERT triggers on chunks
//  3. Search queries JOIN back to chunks, which carries world_uid
const DATA_TABLE_PATTERNS = /\b(quads|chunks)\b/i;

function valueTupleEnd(value: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === quote) {
        if (value[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function valueTupleStarts(value: string): number[] {
  const starts: number[] = [];
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === quote) {
        if (value[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") starts.push(i);
  }
  return starts;
}

function countValueRows(values: string): number {
  return valueTupleStarts(values).filter((start) => {
    const prefix = values.slice(0, start).trim();
    return prefix === "" || prefix.endsWith(",");
  }).length;
}

function appendWorldUidToValueRows(values: string): string {
  const starts = valueTupleStarts(values).filter((start) => {
    const prefix = values.slice(0, start).trim();
    return prefix === "" || prefix.endsWith(",");
  });
  let rewritten = values;
  for (let i = starts.length - 1; i >= 0; i--) {
    const end = valueTupleEnd(rewritten, starts[i]);
    if (end >= 0)
      rewritten = `${rewritten.slice(0, end)}, ?${rewritten.slice(end)}`;
  }
  return rewritten;
}

export class WorldScopedD1 {
  constructor(
    private readonly db: D1Database,
    private readonly worldUid: string,
  ) {}

  prepare(sql: string): WorldScopedStatement {
    const {
      sql: rewritten,
      needsWorldUid,
      worldUidRepeatCount,
      splicePosition,
    } = this.maybeRewrite(sql);
    const inner = this.db.prepare(rewritten);
    return new WorldScopedStatement(
      inner,
      this.worldUid,
      needsWorldUid,
      worldUidRepeatCount,
      splicePosition,
    );
  }

  batch(
    statements: (WorldScopedStatement | D1PreparedStatement)[],
  ): Promise<unknown[]> {
    const innerStatements = statements.map((s) =>
      s instanceof WorldScopedStatement ? s.inner : s,
    );
    return this.db.batch(innerStatements);
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  private maybeRewrite(sql: string): {
    sql: string;
    needsWorldUid: boolean;
    worldUidRepeatCount: number;
    /** Position in the original args array where world_uid should be spliced.
     * -1 means append at end (INSERT case). */
    splicePosition: number;
  } {
    // Skip DDL, and skip if world_uid is already present
    if (/^\s*(CREATE|ALTER|DROP)\b/i.test(sql)) {
      return {
        sql,
        needsWorldUid: false,
        worldUidRepeatCount: 0,
        splicePosition: -1,
      };
    }
    if (/world_uid/i.test(sql)) {
      return {
        sql,
        needsWorldUid: false,
        worldUidRepeatCount: 0,
        splicePosition: -1,
      };
    }
    // Only rewrite queries touching per-world data tables
    if (!DATA_TABLE_PATTERNS.test(sql)) {
      return {
        sql,
        needsWorldUid: false,
        worldUidRepeatCount: 0,
        splicePosition: -1,
      };
    }

    if (/^\s*INSERT\b/i.test(sql)) {
      const { sql: rewritten, rowCount } = this.rewriteInsert(sql);
      if (rowCount === 0) {
        return {
          sql,
          needsWorldUid: false,
          worldUidRepeatCount: 0,
          splicePosition: -1,
        };
      }
      return {
        sql: rewritten,
        needsWorldUid: true,
        worldUidRepeatCount: rowCount,
        splicePosition: -1, // append at end
      };
    }
    if (/\bWHERE\b/i.test(sql)) {
      const { sql: rewritten, splicePosition } = this.rewriteWhere(sql);
      return {
        sql: rewritten,
        needsWorldUid: true,
        worldUidRepeatCount: 1,
        splicePosition,
      };
    }
    return {
      sql,
      needsWorldUid: false,
      worldUidRepeatCount: 0,
      splicePosition: -1,
    };
  }

  private rewriteInsert(sql: string): { sql: string; rowCount: number } {
    // INSERT [OR REPLACE] INTO table (col1, col2, ...) VALUES (?,?, ...), (?,?, ...)
    // → INSERT [OR REPLACE] INTO table (col1, col2, ..., world_uid) VALUES (?,?, ..., ?), (?,?, ..., ?)
    const match = sql.match(
      /^(INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+\S+)\s*\(([^)]+)\)\s*(VALUES\s+)(.+)\s*$/is,
    );
    if (!match) return { sql, rowCount: 0 };
    const [, into, cols, valuesKw, valuesPart] = match;
    // Count only top-level VALUES tuples. Bindings generated by the SDK can
    // contain parenthesized expressions, so a regex over `),(` is unsafe.
    const rowCount = countValueRows(valuesPart);
    const rewritten = appendWorldUidToValueRows(valuesPart);
    return {
      sql: `${into} (${cols}, world_uid) ${valuesKw}${rewritten}`,
      rowCount,
    };
  }

  private rewriteWhere(sql: string): { sql: string; splicePosition: number } {
    // Insert AND world_uid = ? inside the WHERE clause, before ORDER BY/LIMIT/GROUP BY
    const whereEnd = sql.match(/\b(ORDER\s+BY|LIMIT|GROUP\s+BY)\b/i);
    if (whereEnd) {
      const before = sql.slice(0, whereEnd.index);
      // Count ? placeholders before the insertion point — that's the splice position
      const splicePosition = (before.match(/\?/g) || []).length;
      return {
        sql: before + " AND world_uid = ? " + sql.slice(whereEnd.index!),
        splicePosition,
      };
    }
    return { sql: `${sql} AND world_uid = ?`, splicePosition: -1 };
  }
}

/**
 * Wraps a real D1PreparedStatement to auto-append the world_uid binding value.
 * The caller binds their own args as usual; this class appends world_uid as the
 * final parameter.
 */
export class WorldScopedStatement {
  public readonly inner: D1PreparedStatement;
  private readonly worldUid: string;
  private readonly needsWorldUid: boolean;
  private readonly worldUidRepeatCount: number;
  private readonly splicePosition: number;

  constructor(
    inner: D1PreparedStatement,
    worldUid: string,
    needsWorldUid: boolean,
    worldUidRepeatCount = 1,
    splicePosition = -1,
  ) {
    this.inner = inner;
    this.worldUid = worldUid;
    this.needsWorldUid = needsWorldUid;
    this.worldUidRepeatCount = worldUidRepeatCount;
    this.splicePosition = splicePosition;
  }

  bind(...values: unknown[]): WorldScopedStatement {
    if (this.needsWorldUid) {
      const worldUidArgs = Array.from(
        { length: this.worldUidRepeatCount },
        () => this.worldUid,
      );
      let newArgs: unknown[];
      if (this.splicePosition >= 0) {
        // Splice world_uid at the correct position (SELECT WHERE case)
        newArgs = [
          ...values.slice(0, this.splicePosition),
          ...worldUidArgs,
          ...values.slice(this.splicePosition),
        ];
      } else {
        // Append at end (INSERT case)
        newArgs = [...values, ...worldUidArgs];
      }
      return new WorldScopedStatement(
        this.inner.bind(...newArgs),
        this.worldUid,
        false,
        1,
      );
    }
    return new WorldScopedStatement(
      this.inner.bind(...values),
      this.worldUid,
      false,
      1,
    );
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.inner.all<T>();
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.inner.first<T>();
  }

  run(): Promise<{ success: boolean; meta: { changes: number } }> {
    return this.inner.run();
  }
}
