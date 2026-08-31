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
 *
 * Known limitations:
 * - INSERT requires an explicit column list: INSERT INTO quads VALUES (...)
 *   is NOT rewritten (the regex needs (col1, col2, ...) syntax).
 * - SELECT/UPDATE/DELETE without a WHERE clause are NOT rewritten — they
 *   would return/modify ALL worlds' data. Only queries that already have
 *   a WHERE clause get the world_uid filter appended.
 * - Subqueries with mixed table references may not be fully scoped.
 * - Only @worlds/cloudflare SDK queries should touch quads/chunks tables;
 *   direct queries against these tables bypass this wrapper entirely.
 */

const DATA_TABLE_PATTERNS = /\b(quads|chunks|chunks_fts)\b/i;

export class WorldScopedD1 {
  constructor(
    private readonly db: D1Database,
    private readonly worldUid: string,
  ) {}

  prepare(sql: string): WorldScopedStatement {
    const { sql: rewritten, needsWorldUid } = this.maybeRewrite(sql);
    const inner = this.db.prepare(rewritten);
    return new WorldScopedStatement(inner, this.worldUid, needsWorldUid);
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
  } {
    // Skip DDL, and skip if world_uid is already present
    if (/^\s*(CREATE|ALTER|DROP)\b/i.test(sql)) {
      return { sql, needsWorldUid: false };
    }
    if (/world_uid/i.test(sql)) {
      return { sql, needsWorldUid: false };
    }
    // Only rewrite queries touching per-world data tables
    if (!DATA_TABLE_PATTERNS.test(sql)) {
      return { sql, needsWorldUid: false };
    }

    if (/^\s*INSERT\b/i.test(sql)) {
      return { sql: this.rewriteInsert(sql), needsWorldUid: true };
    }
    if (/\bWHERE\b/i.test(sql)) {
      return { sql: this.rewriteWhere(sql), needsWorldUid: true };
    }
    return { sql, needsWorldUid: false };
  }

  private rewriteInsert(sql: string): string {
    // INSERT INTO table (col1, col2, ...) VALUES (?,?, ...)
    // → INSERT INTO table (col1, col2, ..., world_uid) VALUES (?,?, ..., ?)
    const match = sql.match(
      /^(INSERT\s+INTO\s+\S+)\s*\(([^)]+)\)\s*(VALUES\s*\()(.+)$/is,
    );
    if (!match) return sql;
    const [, into, cols, valuesKw, valuesPart] = match;
    return `${into} (${cols}, world_uid) ${valuesKw}${valuesPart}, ?`;
  }

  private rewriteWhere(sql: string): string {
    return `${sql} AND world_uid = ?`;
  }
}

/**
 * Wraps a real D1PreparedStatement to auto-append the world_uid binding value.
 * The caller binds their own args as usual; this class appends world_uid as
 * the final parameter.
 */
export class WorldScopedStatement {
  public readonly inner: D1PreparedStatement;
  private readonly worldUid: string;
  private readonly needsWorldUid: boolean;

  constructor(
    inner: D1PreparedStatement,
    worldUid: string,
    needsWorldUid: boolean,
  ) {
    this.inner = inner;
    this.worldUid = worldUid;
    this.needsWorldUid = needsWorldUid;
  }

  bind(...values: unknown[]): WorldScopedStatement {
    if (this.needsWorldUid) {
      return new WorldScopedStatement(
        this.inner.bind(...values, this.worldUid),
        this.worldUid,
        false, // already appended
      );
    }
    return new WorldScopedStatement(
      this.inner.bind(...values),
      this.worldUid,
      false,
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
