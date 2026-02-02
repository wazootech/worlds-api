import type { Client } from "@libsql/client";
import type { Embeddings } from "#/server/embeddings/embeddings.ts";
import { searchFacts } from "#/server/db/resources/facts/queries.sql.ts";

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
    const vector = await this.embeddings.embed(query);
    const limit = options.limit ?? 20;

    const result = await this.client.execute({
      sql: searchFacts,
      args: [
        new Float32Array(vector).buffer, // vector32(?)
        limit, // vec limit
        query, // fts match
        limit, // fts limit
        options.subjects ? 1 : null, // ? IS NULL for item_id
        options.subjects ? JSON.stringify(options.subjects) : null,
        options.predicates ? 1 : null, // ? IS NULL for property
        options.predicates ? JSON.stringify(options.predicates) : null,
        limit, // final limit
      ],
    });

    return result.rows.map((row) => ({
      itemId: row.item_id as string,
      property: row.property as string,
      value: row.value as string,
      vecRank: row.vec_rank as number | null,
      ftsRank: row.fts_rank as number | null,
      combinedRank: row.combined_rank as number,
    }));
  }
}
