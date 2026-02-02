import type { Client } from "@libsql/client";
import type { Embeddings } from "#/server/embeddings/embeddings.ts";

export interface SearchOptions {
  organizationId: string;
  worldIds?: string[];
  limit?: number;
  subjects?: string[];
  predicates?: string[];
}

export interface SearchResult {
  itemId: string;
  property: string;
  value: string;
  vecRank: number | null;
  ftsRank: number | null;
  combinedRank: number;
}

export class LibsqlSearchStoreManager {
  private client: Client;
  private embeddings: Embeddings;

  constructor(options: { client: Client; embeddings: Embeddings }) {
    this.client = options.client;
    this.embeddings = options.embeddings;
  }

  async search(
    query: string,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    try {
      const vector = await this.embeddings.embed(query);
      const limit = options.limit ?? 20;

      // Check if vector functions exist in this environment
      const functions = await this.client.execute("PRAGMA function_list");
      const hasVectorSupport = functions.rows.some((r) =>
        r.name === "vector32_distance"
      );

      let robustSearchSql: string;
      if (hasVectorSupport) {
        robustSearchSql = `
          WITH vec_matches AS (
            SELECT
              rowid,
              row_number() OVER (ORDER BY vector32_distance(vector, vector32(?))) AS rank_number
            FROM facts
            WHERE vector IS NOT NULL
            LIMIT ?
          ),
          fts_matches AS (
            SELECT
              rowid,
              row_number() OVER (ORDER BY rank) AS rank_number
            FROM facts_fts
            WHERE facts_fts MATCH ?
            LIMIT ?
          ),
          final AS (
            SELECT
              facts.item_id,
              facts.property,
              facts.value,
              v.rank_number AS vec_rank,
              f.rank_number AS fts_rank,
              (COALESCE(1.0 / (60 + f.rank_number), 0.0) + COALESCE(1.0 / (60 + v.rank_number), 0.0)) AS combined_rank
            FROM fts_matches f
            FULL OUTER JOIN vec_matches v ON v.rowid = f.rowid
            JOIN facts ON facts.rowid = COALESCE(f.rowid, v.rowid)
            WHERE (? IS NULL OR facts.item_id IN (SELECT value FROM json_each(?)))
              AND (? IS NULL OR facts.property IN (SELECT value FROM json_each(?)))
            ORDER BY combined_rank DESC
            LIMIT ?
          )
          SELECT * FROM final;
        `;
      } else {
        // Fallback for environments without vector support (like in-memory testing)
        robustSearchSql = `
          WITH fts_matches AS (
            SELECT
              rowid,
              row_number() OVER (ORDER BY rank) AS rank_number
            FROM facts_fts
            WHERE facts_fts MATCH ?
            LIMIT ?
          ),
          final AS (
            SELECT
              facts.item_id,
              facts.property,
              facts.value,
              NULL AS vec_rank,
              f.rank_number AS fts_rank,
              COALESCE(1.0 / (60 + f.rank_number), 0.0) AS combined_rank
            FROM fts_matches f
            JOIN facts ON facts.rowid = f.rowid
            WHERE (? IS NULL OR facts.item_id IN (SELECT value FROM json_each(?)))
              AND (? IS NULL OR facts.property IN (SELECT value FROM json_each(?)))
            ORDER BY combined_rank DESC
            LIMIT ?
          )
          SELECT * FROM final;
        `;
      }

      const args = hasVectorSupport
        ? [
          new Uint8Array(new Float32Array(vector).buffer),
          limit,
          query,
          limit,
          options.subjects ? 1 : null,
          options.subjects ? JSON.stringify(options.subjects) : null,
          options.predicates ? 1 : null,
          options.predicates ? JSON.stringify(options.predicates) : null,
          limit,
        ]
        : [
          query,
          limit,
          options.subjects ? 1 : null,
          options.subjects ? JSON.stringify(options.subjects) : null,
          options.predicates ? 1 : null,
          options.predicates ? JSON.stringify(options.predicates) : null,
          limit,
        ];

      const result = await this.client.execute({
        sql: robustSearchSql,
        args,
      });

      return result.rows.map((row) => ({
        itemId: row.item_id as string,
        property: row.property as string,
        value: row.value as string,
        vecRank: row.vec_rank as number | null,
        ftsRank: row.fts_rank as number | null,
        combinedRank: row.combined_rank as number,
      }));
    } catch (error) {
      console.error(`[DEBUG] Store search failed!`);
      if (error instanceof Error) {
        console.error(`[DEBUG] Error Message: ${error.message}`);
      }
      throw error;
    }
  }
}
