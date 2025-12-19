import {
  blankNode,
  defaultGraph,
  literal,
  namedNode,
  type Quad,
  Store,
  type Term,
} from "oxigraph";
import type { Client } from "#/database/database.ts";
import type { OxigraphService, StoreMetadata } from "./service.ts";
import type { Chunk, RankedResult, Statement } from "#/sdk/types/mod.ts";
import { openDatabase } from "#/database/database.ts";
import type { StatementRow } from "#/database/statements.ts";

export class SqliteOxigraphService implements OxigraphService {
  /**
   * db is the system database (sys.db).
   */
  constructor(private readonly db: Client) {}

  async listStores(): Promise<string[]> {
    const result = await this.db.execute("SELECT world_id FROM kb_worlds");
    const rows = result.rows as unknown as { world_id: string }[];
    return rows.map((r) => r.world_id);
  }

  async getStore(id: string): Promise<Store | null> {
    const store = new Store();
    const worldDb = await openDatabase(`world_${id}.db`);
    try {
      const result = await worldDb.execute("SELECT * FROM kb_statements");
      const rows = result.rows as unknown as StatementRow[];
      for (const row of rows) {
        store.add({
          subject: this.fromTerm(row.subject),
          predicate: namedNode(row.predicate),
          object: this.fromTerm(
            row.object,
            row.term_type === "Literal" ? "Literal" : "NamedNode",
            row.object_language,
            row.object_datatype,
          ),
          graph: row.graph ? namedNode(row.graph) : defaultGraph(),
        } as Quad);
      }
    } catch (_) {
      // Ignore errors if table doesn't exist
    } finally {
      worldDb.close();
    }

    return store;
  }

  async setStore(id: string, owner: string, store: Store): Promise<void> {
    // Insert world record
    await this.db.execute({
      sql: `
        INSERT OR IGNORE INTO kb_worlds (world_id, account_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [id, owner, `World ${id}`, Date.now(), Date.now()],
    });

    const worldDb = await openDatabase(`world_${id}.db`);

    // Init schema
    await worldDb.execute(`
        CREATE TABLE IF NOT EXISTS kb_statements (
          statement_id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          graph TEXT NOT NULL,
          term_type TEXT NOT NULL DEFAULT 'NamedNode',
          object_language TEXT NOT NULL DEFAULT '',
          object_datatype TEXT NOT NULL DEFAULT '',
          CONSTRAINT kb_statement_unique UNIQUE (
            subject, predicate, object, graph, term_type, object_language, object_datatype
          )
        );
     `);

    // Delete all and insert new
    // We use a batch for atomicity and speed
    const stmts = [];
    stmts.push({ sql: "DELETE FROM kb_statements", args: [] }); // Clear existing

    // We can't batch too many at once if the store is huge, but for now we assume it fits.
    // If huge, we'd chunk it.
    for (const quad of store.match()) {
      stmts.push({
        sql: `
            INSERT INTO kb_statements (subject, predicate, object, graph, term_type, object_language, object_datatype)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
        args: [
          quad.subject.value,
          quad.predicate.value,
          quad.object.value,
          quad.graph.value,
          quad.object.termType,
          (quad.object as { language?: string }).language || "",
          (quad.object as { datatype?: { value: string } }).datatype?.value ||
          "",
        ],
      });
    }

    if (stmts.length > 0) {
      await worldDb.batch(stmts, "write");
    }

    worldDb.close();
    await this.updateMetadataTimestamp(id);
  }

  // Helpers for Term conversion
  private fromTerm(
    value: string,
    type?: string,
    language?: string,
    datatype?: string,
  ): Term {
    if (type === "BlankNode") return blankNode(value);
    if (type === "Literal") {
      return literal(
        value,
        language ||
          namedNode(datatype || "http://www.w3.org/2001/XMLSchema#string"),
      );
    }
    if (type === "DefaultGraph") return defaultGraph();
    return namedNode(value);
  }

  async getMetadata(id: string): Promise<StoreMetadata | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM kb_worlds WHERE world_id = ?",
      args: [id],
    });
    const row = result.rows[0] as unknown as {
      world_id: string;
      description: string;
      created_at: number;
      account_id: string;
      updated_at: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.world_id,
      description: row.description || "",
      size: 0,
      tripleCount: await this.countTriples(row.world_id),
      createdAt: row.created_at,
      createdBy: row.account_id,
      updatedAt: row.updated_at,
    };
  }

  private async countTriples(id: string): Promise<number> {
    try {
      const worldDb = await openDatabase(`world_${id}.db`);
      const result = await worldDb.execute(
        "SELECT COUNT(*) as count FROM kb_statements",
      );
      worldDb.close();
      const row = result.rows[0] as unknown as { count: number };
      return row.count;
    } catch (_) {
      return 0;
    }
  }

  getManyMetadata(ids: string[]): Promise<(StoreMetadata | null)[]> {
    return Promise.all(ids.map((id) => this.getMetadata(id)));
  }

  private async updateMetadataTimestamp(id: string) {
    await this.db.execute({
      sql: "UPDATE kb_worlds SET updated_at = ? WHERE world_id = ?",
      args: [Date.now(), id],
    });
  }

  async addQuads(id: string, owner: string, quads: Quad[]): Promise<void> {
    // Ensure world exists first (implicit in setStore, but explicit here might be good)
    // Actually setStore creates the world record.
    // If we just add quads to a non-existent world, we might want to create it.
    // For now, let's just insert.

    // We also need to ensure the table schema exists.
    // Opening the DB creates it if using file:, but tables need creation.
    // We can reuse setStore logic effectively or duplicate the init calls.
    // For efficiency, we just open and append.

    // If the world doesn't exist in kb_worlds, we should probably add it.
    await this.db.execute({
      sql: `
        INSERT OR IGNORE INTO kb_worlds (world_id, account_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [id, owner, `World ${id}`, Date.now(), Date.now()],
    });

    const worldDb = await openDatabase(`world_${id}.db`);
    await worldDb.execute(`
        CREATE TABLE IF NOT EXISTS kb_statements (
          statement_id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          graph TEXT NOT NULL,
          term_type TEXT NOT NULL DEFAULT 'NamedNode',
          object_language TEXT NOT NULL DEFAULT '',
          object_datatype TEXT NOT NULL DEFAULT '',
          CONSTRAINT kb_statement_unique UNIQUE (
            subject, predicate, object, graph, term_type, object_language, object_datatype
          )
        );
     `);

    const stmts = [];
    for (const quad of quads) {
      stmts.push({
        sql: `
            INSERT OR IGNORE INTO kb_statements (subject, predicate, object, graph, term_type, object_language, object_datatype)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
        args: [
          quad.subject.value,
          quad.predicate.value,
          quad.object.value,
          quad.graph.value,
          quad.object.termType,
          (quad.object as { language?: string }).language || "",
          (quad.object as { datatype?: { value: string } }).datatype?.value ||
          "",
        ],
      });
    }

    if (stmts.length > 0) {
      await worldDb.batch(stmts, "write");
    }

    worldDb.close();
    await this.updateMetadataTimestamp(id);
  }

  async query(
    id: string,
    query: string,
  ): Promise<boolean | Map<string, Term>[] | Quad[] | string> {
    const store = await this.getStore(id);
    if (!store) return [];
    // Oxigraph store.query result needs careful handling if strict types expected
    return store.query(query);
  }

  async update(id: string, query: string): Promise<void> {
    const store = await this.getStore(id);
    if (!store) throw new Error("Store not found");
    store.update(query);
    const metadata = await this.getMetadata(id);
    await this.setStore(id, metadata?.createdBy || "unknown", store);
  }

  async updateDescription(id: string, description: string): Promise<void> {
    await this.db.execute({
      sql:
        "UPDATE kb_worlds SET description = ?, updated_at = ? WHERE world_id = ?",
      args: [description, Date.now(), id],
    });
  }

  async removeStore(id: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM kb_worlds WHERE world_id = ?",
      args: [id],
    });
    try {
      Deno.removeSync(`world_${id}.db`);
    } catch (_) {
      // Ignore
    }
  }

  async searchStatements(
    id: string,
    query: string,
  ): Promise<RankedResult<Statement>[]> {
    const worldDb = await openDatabase(`world_${id}.db`);
    const result = await worldDb.execute({
      sql: `
        SELECT * FROM kb_statements 
        WHERE subject LIKE ? OR object LIKE ? OR predicate LIKE ?
        LIMIT 20
        `,
      args: [`%${query}%`, `%${query}%`, `%${query}%`],
    });
    const rows = result.rows as unknown as StatementRow[];

    worldDb.close();

    return rows.map((row) => ({
      item: {
        statementId: row.statement_id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        graph: row.graph,
        termType: row.term_type || "NamedNode",
        objectLanguage: row.object_language,
        objectDatatype: row.object_datatype,
      } as Statement,
      score: 1.0,
      rank: { match: 1 },
    }));
  }

  async getStatement(
    id: string,
    statementId: number,
  ): Promise<Statement | null> {
    const worldDb = await openDatabase(`world_${id}.db`);
    const result = await worldDb.execute({
      sql: "SELECT * FROM kb_statements WHERE statement_id = ?",
      args: [statementId],
    });
    worldDb.close();

    const row = result.rows[0] as unknown as StatementRow | undefined;
    if (!row) return null;

    return {
      statementId: row.statement_id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      graph: row.graph,
      termType: row.term_type || "NamedNode",
      objectLanguage: row.object_language,
      objectDatatype: row.object_datatype,
    } as Statement;
  }

  searchChunks(
    _id: string,
    _query: string,
  ): Promise<RankedResult<Chunk>[]> {
    return Promise.resolve([]);
  }

  getChunk(_id: string, _chunkId: number): Promise<Chunk | null> {
    return Promise.resolve(null);
  }
}
