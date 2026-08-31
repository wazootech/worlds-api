import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({
        description:
          "Machine-readable error code, e.g. NOT_FOUND, INVALID_ARGUMENT, RATE_LIMITED.",
      }),
      message: z.string().openapi({
        description: "Human-readable error message describing what went wrong.",
      }),
    }),
  })
  .openapi("ErrorResponse");

export const WorldResourceSchema = z
  .object({
    name: z.string().openapi({
      description:
        "Resource name in the form worlds/<uid>, e.g. worlds/w_a1b2c3d4.",
    }),
    uid: z.string().openapi({
      description: "Unique world identifier, e.g. w_<uuid>.",
    }),
    displayName: z.string().openapi({
      description:
        "User-facing display name for the world. Set on creation or update.",
    }),
    state: z.string().openapi({
      description:
        "Lifecycle state: active, deleted, or suspended. Deleted worlds enter a 30-day grace period before permanent purge.",
    }),
    storage: z.literal("d1").openapi({
      description: "Storage backend for the world. All worlds share a single Cloudflare D1 database, separated by world_uid.",
    }),
    embeddingModel: z.string().openapi({
      description:
        "Embedding model identifier used for vector search indexing, e.g. openai/text-embedding-3-small.",
    }),
    chunkSize: z.number().int().openapi({
      description:
        "Maximum number of RDF quads per chunk when indexing for vector search.",
    }),
    topK: z.number().int().openapi({
      description:
        "Default number of top search results to return when the caller does not override.",
    }),
    minScore: z.number().openapi({
      description:
        "Default minimum relevance score (0–1) for search results. Results below this threshold are omitted.",
    }),
    createTime: z.string().openapi({
      description: "ISO 8601 timestamp when the world was created.",
    }),
    updateTime: z.string().openapi({
      description: "ISO 8601 timestamp when the world was last updated.",
    }),
    deleteTime: z.string().optional().openapi({
      description:
        "ISO 8601 timestamp when the world was soft-deleted. Null if not deleted.",
    }),
    expireTime: z.string().optional().openapi({
      description:
        "ISO 8601 timestamp when the world will be permanently purged after the grace period. Null if not scheduled for purge.",
    }),
  })
  .openapi("WorldResource");

export const CreateWorldRequestSchema = z
  .object({
    displayName: z.string().optional().openapi({
      description: "User-facing display name for the new world.",
    }),
    embeddingModel: z.string().optional().openapi({
      description:
        "Embedding model to use for vector search. Defaults to the platform default.",
    }),
    chunkSize: z.number().int().positive().optional().openapi({
      description:
        "Maximum quads per chunk for vector search indexing. Defaults to the platform default.",
    }),
    topK: z.number().int().positive().optional().openapi({
      description:
        "Default number of top results for search queries against this world.",
    }),
    minScore: z.number().min(0).max(1).optional().openapi({
      description:
        "Default minimum relevance score (0–1) for search results in this world.",
    }),
  })
  .openapi("CreateWorldRequest");

export const UpdateWorldRequestSchema = z
  .object({
    displayName: z.string().min(1).optional().openapi({
      description: "New display name for the world.",
    }),
    embeddingModel: z.string().optional().openapi({
      description:
        "New embedding model. Changing this triggers a reindex of existing data.",
    }),
    chunkSize: z.number().int().positive().optional().openapi({
      description: "New chunk size for vector search indexing.",
    }),
    topK: z.number().int().positive().optional().openapi({
      description: "New default top-K for search queries.",
    }),
    minScore: z.number().min(0).max(1).optional().openapi({
      description: "New default minimum score threshold for search results.",
    }),
  })
  .openapi("UpdateWorldRequest");

export const SearchRequestSchema = z
  .object({
    query: z.string().min(1).openapi({
      description:
        "Natural language or keyword search query to find matching content in the world.",
    }),
    limit: z.number().int().positive().optional().default(20).openapi({
      description:
        "Maximum number of results to return. Defaults to 20. The response is capped at this value after ranking.",
    }),
    topK: z.number().int().positive().optional().openapi({
      description:
        "Override the world's default top-K for vector similarity search. Higher values improve recall at the cost of latency.",
    }),
    minScore: z.number().min(0).max(1).optional().openapi({
      description:
        "Override the world's minimum relevance score. Results below this threshold are omitted.",
    }),
  })
  .openapi("SearchRequest");

export const SearchResultSchema = z
  .object({
    subject: z.string().openapi({
      description:
        "RDF subject URI identifying the matched resource, e.g. https://example.org/entity/42.",
    }),
    predicate: z.string().openapi({
      description:
        "RDF predicate URI describing the relationship, e.g. http://schema.org/name.",
    }),
    graph: z.string().optional().openapi({
      description:
        "Named graph URI the quad belongs to. Null when the world uses a default graph.",
    }),
    content: z.string().optional().openapi({
      description:
        "Text content extracted from the matched quad, used for display and snippet generation.",
    }),
    score: z.number().optional().openapi({
      description:
        "Relevance score from the search engine (0–1). Higher scores indicate better matches. Null for fallback LIKE search results.",
    }),
  })
  .openapi("SearchResult");

export const SparqlRequestSchema = z
  .object({
    query: z.string().min(1).openapi({
      description:
        "SPARQL 1.1 query string. Supports SELECT, ASK, and SPARQL UPDATE (INSERT/DELETE). SELECT results are limited by the server-configured maximum.",
    }),
  })
  .openapi("SparqlRequest");

export const ImportRequestSchema = z
  .object({
    data: z.string().min(1).openapi({
      description:
        "RDF payload to import. The format must match the contentType field.",
    }),
    contentType: z.string().optional().default("text/turtle").openapi({
      description:
        "MIME type of the import payload. Supported values: text/turtle, application/n-quads, application/n-triples, application/trig, application/ld+json. Defaults to text/turtle.",
    }),
  })
  .openapi("ImportRequest");

export const ImportResponseSchema = z
  .object({
    imported: z
      .object({
        quads: z.number().int().openapi({
          description: "Number of RDF quads successfully imported.",
        }),
        chunks: z.number().int().openapi({
          description:
            "Number of vector search chunks created from the imported quads.",
        }),
      })
      .openapi({
        description: "Imported quad and chunk counts.",
      }),
  })
  .openapi("ImportResponse");

export const QuadSchema = z
  .object({
    subject: z.string().openapi({
      description: "RDF subject URI.",
    }),
    predicate: z.string().openapi({
      description: "RDF predicate URI.",
    }),
    object: z.string().openapi({
      description: "RDF object URI or literal value.",
    }),
    graph: z.string().optional().openapi({
      description:
        "Named graph URI. Null when the quad belongs to the default graph.",
    }),
  })
  .openapi("Quad");

export const ExportQuadsResponseSchema = z
  .object({
    quads: z.array(QuadSchema).openapi({
      description: "Page of exported RDF quads.",
    }),
    nextOffset: z.number().int().optional().openapi({
      description:
        "Offset for the next page. Omit this field when there are no more results.",
    }),
  })
  .openapi("ExportQuadsResponse");

export const ApiKeyCreateRequestSchema = z
  .object({
    namespace: z.string().min(1).openapi({
      description:
        "Namespace to scope the API key to. Required. The key can only access worlds within this namespace.",
    }),
    worldId: z.string().optional().openapi({
      description:
        "Optional world ID to scope the key to a single world. Omit to allow access to all worlds in the namespace.",
    }),
    name: z.string().optional().openapi({
      description:
        "Human-readable label for the key. Helps identify keys in the list.",
    }),
    scopes: z
      .array(z.enum(["data:read", "data:write"]))
      .optional()
      .openapi({
        description:
          'Optional scope grant. Defaults to ["data:read", "data:write"]. Use ["data:read"] for read-only keys.',
      }),
  })
  .openapi("ApiKeyCreateRequest");

export const ApiKeyCreateResponseSchema = z
  .object({
    uid: z.string().openapi({
      description: "Unique identifier for the created API key.",
    }),
    token: z.string().openapi({
      description:
        "The full bearer token (wzw format). Displayed once on creation — store it securely.",
    }),
    name: z.string().openapi({
      description: "Human-readable label for the key.",
    }),
    namespace: z.string().openapi({
      description: "Namespace the key is scoped to.",
    }),
    worldId: z.string().nullable().openapi({
      description:
        "World ID the key is scoped to, or null if the key has namespace-wide access.",
    }),
    createTime: z.string().openapi({
      description: "ISO 8601 timestamp when the key was created.",
    }),
  })
  .openapi("ApiKeyCreateResponse");

export const ApiKeyResourceSchema = z
  .object({
    uid: z.string().openapi({
      description: "Unique identifier for the API key.",
    }),
    name: z.string().openapi({
      description: "Human-readable label for the key.",
    }),
    namespace: z.string().openapi({
      description: "Namespace the key is scoped to.",
    }),
    worldId: z.string().optional().openapi({
      description:
        "World ID the key is scoped to, or absent for namespace-wide keys.",
    }),
    scopes: z.array(z.string()).openapi({
      description: 'Granted scopes, e.g. ["data:read", "data:write"].',
    }),
    createTime: z.string().openapi({
      description: "ISO 8601 timestamp when the key was created.",
    }),
  })
  .openapi("ApiKeyResource");

export const worldIdParam = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path", required: true },
    description: "The canonical world_uid, e.g. w_<uuid>.",
  }),
});

export const keyIdParam = z.object({
  keyId: z.string().openapi({
    param: { name: "keyId", in: "path", required: true },
    description: "Unique identifier of the API key to revoke.",
  }),
});

export const exportQuery = z.object({
  format: z
    .string()
    .optional()
    .default("application/json")
    .openapi({
      param: { name: "format", in: "query" },
      description:
        "Export format. Supported: application/json (RDF/JSON array), text/turtle (Turtle), application/trig (TriG), application/ld+json (JSON-LD). Defaults to application/json.",
    }),
  limit: z
    .string()
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      description: "Maximum number of quads to return in this page.",
    }),
  offset: z
    .string()
    .optional()
    .openapi({
      param: { name: "offset", in: "query" },
      description:
        "Pagination offset. Use the nextOffset value from the previous response.",
    }),
});

export const apiKeysListQuery = z.object({
  namespace: z
    .string()
    .optional()
    .openapi({
      param: { name: "namespace", in: "query" },
      description: "Filter API keys by namespace.",
    }),
});

export const worldsListQuery = z.object({});
