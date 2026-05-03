import { type Client } from "@libsql/client";
import type { StoredQuad } from "./quad.ts";
import type { QuadStorage, QuadStorageConfig } from "./quad-storage.ts";

const BATCH_SIZE = 100;

export class LibsqlQuadStorage implements QuadStorage {
  private initialized = false;

  constructor(
    private readonly client: Client,
    private readonly reference: { namespace?: string; id: string },
    _config?: QuadStorageConfig,
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS quads (
        world_namespace TEXT NOT NULL,
        world_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        graph TEXT NOT NULL DEFAULT '',
        object_term_type TEXT,
        object_datatype TEXT,
        object_language TEXT,
        PRIMARY KEY (world_namespace, world_id, subject, predicate, object, graph)
      )
    `);
    this.initialized = true;
  }

  async setQuad(quad: StoredQuad): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = this.reference;
    const ns = namespace ?? "_";
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO quads
            (world_namespace, world_id, subject, predicate, object, graph, object_term_type, object_datatype, object_language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        ns,
        id,
        quad.subject,
        quad.predicate,
        quad.object,
        quad.graph ?? "",
        quad.objectTermType ?? null,
        quad.objectDatatype ?? null,
        quad.objectLanguage ?? null,
      ],
    });
  }

  async setQuads(quads: StoredQuad[]): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = this.reference;
    const ns = namespace ?? "_";
    for (let i = 0; i < quads.length; i += BATCH_SIZE) {
      const batch = quads.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(
        ", ",
      );
      const args: (string | null)[] = [];
      for (const q of batch) {
        args.push(
          ns,
          id,
          q.subject,
          q.predicate,
          q.object,
          q.graph ?? "",
          q.objectTermType ?? null,
          q.objectDatatype ?? null,
          q.objectLanguage ?? null,
        );
      }
      await this.client.execute({
        sql: `INSERT OR IGNORE INTO quads
              (world_namespace, world_id, subject, predicate, object, graph, object_term_type, object_datatype, object_language)
              VALUES ${placeholders}`,
        args,
      });
    }
  }

  async deleteQuad(quad: StoredQuad): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = this.reference;
    const ns = namespace ?? "_";
    await this.client.execute({
      sql: `DELETE FROM quads
            WHERE world_namespace = ? AND world_id = ? AND subject = ? AND predicate = ? AND object = ? AND graph = ?`,
      args: [
        ns,
        id,
        quad.subject,
        quad.predicate,
        quad.object,
        quad.graph ?? "",
      ],
    });
  }

  async deleteQuads(quads: StoredQuad[]): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = this.reference;
    const ns = namespace ?? "_";
    for (let i = 0; i < quads.length; i += BATCH_SIZE) {
      const batch = quads.slice(i, i + BATCH_SIZE);
      for (const q of batch) {
        await this.client.execute({
          sql: `DELETE FROM quads
                WHERE world_namespace = ? AND world_id = ? AND subject = ? AND predicate = ? AND object = ? AND graph = ?`,
          args: [ns, id, q.subject, q.predicate, q.object, q.graph ?? ""],
        });
      }
    }
  }

  async findQuads(matchers: StoredQuad[]): Promise<StoredQuad[]> {
    await this.ensureInitialized();
    const { namespace, id } = this.reference;
    const ns = namespace ?? "_";

    if (matchers.length === 0) {
      const result = await this.client.execute({
        sql: `SELECT * FROM quads WHERE world_namespace = ? AND world_id = ?`,
        args: [ns, id],
      });
      return result.rows.map((row) => this.rowToQuad(row));
    }

    const rows: StoredQuad[] = [];
    for (const m of matchers) {
      const subject = m.subject ?? "";
      const predicate = m.predicate ?? "";
      const object = m.object ?? "";
      const graph = m.graph ?? "";
      const result = await this.client.execute({
        sql: `SELECT * FROM quads
              WHERE world_namespace = ? AND world_id = ?
                AND (subject = ? OR ? = '')
                AND (predicate = ? OR ? = '')
                AND (object = ? OR ? = '')
                AND (graph = ? OR ? = '')`,
        args: [
          ns,
          id,
          subject,
          subject,
          predicate,
          predicate,
          object,
          object,
          graph,
          graph,
        ],
      });
      rows.push(...result.rows.map((row) => this.rowToQuad(row)));
    }
    return rows;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    const { namespace, id } = this.reference;
    const ns = namespace ?? "_";
    await this.client.execute({
      sql: `DELETE FROM quads WHERE world_namespace = ? AND world_id = ?`,
      args: [ns, id],
    });
  }

  private rowToQuad(row: Record<string, unknown>): StoredQuad {
    const termType = row["object_term_type"] as string | null;
    const datatype = row["object_datatype"] as string | null;
    const language = row["object_language"] as string | null;
    const quad: StoredQuad = {
      subject: row["subject"] as string,
      predicate: row["predicate"] as string,
      object: row["object"] as string,
      graph: row["graph"] as string,
    };
    if (termType === "NamedNode" || termType === "BlankNode" ||
        termType === "Literal") {
      quad.objectTermType = termType;
    }
    if (datatype) quad.objectDatatype = datatype;
    if (language) quad.objectLanguage = language;
    return quad;
  }
}
