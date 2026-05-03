import type {
  CreateWorldRequest,
  DeleteWorldRequest,
  ExportWorldRequest,
  GetWorldRequest,
  ImportWorldRequest,
  ListWorldsRequest,
  ListWorldsResponse,
  SearchRequest,
  SearchResponse,
  SparqlRequest,
  SparqlResponse,
  UpdateWorldRequest,
  World,
} from "#/rpc/openapi/generated/types.gen.ts";

/**
 * DataPlane defines the data operations interface (SPARQL, Search, Import/Export).
 */
export interface DataPlane {
  sparql(input: SparqlRequest): Promise<SparqlResponse>;
  search(input: SearchRequest): Promise<SearchResponse>;
  import(input: ImportWorldRequest): Promise<void>;
  export(input: ExportWorldRequest): Promise<ArrayBuffer>;
}

/**
 * ManagementPlane defines the lifecycle management interface.
 */
export interface ManagementPlane {
  getWorld(input: GetWorldRequest): Promise<World | null>;
  createWorld(input: CreateWorldRequest): Promise<World>;
  updateWorld(input: UpdateWorldRequest): Promise<World>;
  deleteWorld(input: DeleteWorldRequest): Promise<void>;
  listWorlds(input?: ListWorldsRequest): Promise<ListWorldsResponse>;
}

/**
 * WorldsInterface defines the primary interface for Worlds.
 * Combines DataPlane and ManagementPlane into a single unified interface.
 */
export interface WorldsInterface extends DataPlane, ManagementPlane {}
