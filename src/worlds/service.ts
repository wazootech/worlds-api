import type { Quad, Store, Term } from "oxigraph";
import type { Chunk, RankedResult, Statement } from "#/sdk/types/mod.ts";

/**
 * OxigraphService is the service for Oxigraph stores.
 */
export interface OxigraphService {
  listStores(): Promise<string[]>;
  getStore(id: string): Promise<Store | null>;
  getMetadata(id: string): Promise<StoreMetadata | null>;
  getManyMetadata(ids: string[]): Promise<(StoreMetadata | null)[]>;
  setStore(id: string, owner: string, store: Store): Promise<void>;
  addQuads(id: string, owner: string, quads: Quad[]): Promise<void>;
  query(
    id: string,
    query: string,
  ): Promise<boolean | Map<string, Term>[] | Quad[] | string>;
  update(id: string, query: string): Promise<void>;
  updateDescription(id: string, description: string): Promise<void>;
  removeStore(id: string): Promise<void>;

  // Search Capability
  searchStatements(
    id: string,
    query: string,
  ): Promise<RankedResult<Statement>[]>;
  getStatement(
    id: string,
    statementId: number,
  ): Promise<Statement | null>;
  searchChunks(
    id: string,
    query: string,
  ): Promise<RankedResult<Chunk>[]>;
  getChunk(
    id: string,
    chunkId: number,
  ): Promise<Chunk | null>;
}

/**
 * StoreMetadata contains metadata about a store.
 */
export interface StoreMetadata {
  /**
   * id is the store ID.
   */
  id: string;

  /**
   * description is the description of the store.
   */
  description: string;

  /**
   * size is the size of the store in bytes.
   */
  size: number;

  /**
   * tripleCount is the number of triples in the store.
   */
  tripleCount: number;

  /**
   * createdAt is the time the store was created.
   */
  createdAt: number;

  /**
   * createdBy is the account ID of the user who created the store.
   */
  createdBy: string;

  /**
   * updatedAt is the time the store was last updated.
   */
  updatedAt: number;
}
