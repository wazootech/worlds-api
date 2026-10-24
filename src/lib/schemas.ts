import { z } from "@hono/zod-openapi";
import {
  EMBEDDING_MODEL_IDS,
  EMBEDDING_PROVIDER_IDS,
  EMBEDDING_STATUSES,
} from "./embeddings/catalog";

/** `w_` + lowercase Crockford base32 ULID; the first char caps the 48-bit time. */
export const WORLD_ID_PATTERN = /^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

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

export const InferenceSettingSchema = z
  .object({
    enabled: z.boolean().openapi({
      description:
        "Opt the world in to OWL 2 RL materialization on write. false is the same as never setting it.",
    }),
    graphs: z.enum(["per-graph", "union"]).optional().openapi({
      description:
        "Named-graph mode. per-graph (default) lists each entailed quad in the graph(s) that entail it alone; union merges all graphs and lists everything in the default graph.",
    }),
    maxAssertedQuads: z.number().int().positive().optional().openapi({
      description:
        "Size guard (default 100000). A commit that would exceed this many asserted quads fails before writing instead of exhausting the isolate.",
    }),
  })
  .openapi("InferenceSetting");

export const WorldResourceSchema = z
  .object({
    id: z.string().regex(WORLD_ID_PATTERN).openapi({
      description: "Immutable World ID minted by Worlds API as `w_<ULID>`.",
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
      description:
        "Storage backend for the world. All worlds share a single Cloudflare D1 database, separated by world_id.",
    }),
    embeddingModel: z.string().openapi({
      description:
        "Embedding model identifier used for vector search indexing, e.g. openai/text-embedding-3-small or openrouter/openai/text-embedding-3-small. Values outside the allowlist (including the legacy tfjs-universal-sentence-encoder default) are reported as embeddingStatus unconfigured and search stays keyword-only.",
    }),
    embeddingStatus: z.enum(EMBEDDING_STATUSES).openapi({
      description:
        "Whether vector search is usable for this world. unconfigured: embeddings are not enabled or the model is not allowlisted. no_credential: the namespace has no active embedding credential for the provider of this world's model. invalid: the provider rejected the namespace credential. stale: vectors are not built for the current model; search is keyword-only until POST /worlds/{worldId}/reindex. partial: some vectors failed to sync; hybrid search covers what exists. ready: vectors are current.",
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
    inference: InferenceSettingSchema.optional().openapi({
      description:
        "OWL 2 RL inference setting. Omitted when never configured, which means inference is off.",
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
    embeddingModel: z.enum(EMBEDDING_MODEL_IDS).optional().openapi({
      description:
        "Embedding model to use for vector search, as provider/model. Allowlist: openai/text-embedding-3-small (recommended), openai/text-embedding-3-large (pinned to 1536 dimensions), legacy openai/text-embedding-ada-002, and the same OpenAI models through OpenRouter as openrouter/openai/text-embedding-3-small and openrouter/openai/text-embedding-3-large. The model's provider decides which namespace credential is used. Defaults to the platform default, which reports embeddingStatus unconfigured until a model is chosen.",
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
    inference: InferenceSettingSchema.optional().openapi({
      description:
        "Opt the world in to OWL 2 RL inference. Off when omitted. The data plane additionally needs the quads.derived column before enabling.",
    }),
  })
  .openapi("CreateWorldRequest");

export const UpdateWorldRequestSchema = z
  .object({
    displayName: z.string().min(1).optional().openapi({
      description: "New display name for the world.",
    }),
    embeddingModel: z.enum(EMBEDDING_MODEL_IDS).optional().openapi({
      description:
        "New embedding model, as provider/model. Requires an active embedding credential, for the new model's provider, in the namespace. Changing the model marks the world stale (embeddingStatus stale): search is keyword-only until POST /worlds/{worldId}/reindex is called. It does not reindex automatically because reindexing spends the customer's provider budget.",
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
    inference: InferenceSettingSchema.optional().openapi({
      description:
        "Replaces the world's inference setting. Enabling does not back-fill existing data: inferred quads appear only for later changes.",
    }),
  })
  .openapi("UpdateWorldRequest");

export const SearchFilterSchema = z
  .object({
    include: z
      .object({
        subjects: z.array(z.string()).optional().openapi({
          description:
            "Only match quads whose subject is in this list. Applied before ranking.",
        }),
        predicates: z.array(z.string()).optional().openapi({
          description:
            "Only match quads whose predicate is in this list. Applied before ranking.",
        }),
        graphs: z.array(z.string()).optional().openapi({
          description:
            "Only match quads whose graph is in this list. Applied before ranking.",
        }),
      })
      .optional()
      .openapi({
        description:
          "Include allowlist: only quads matching these exact subject/predicate/graph values are candidates.",
      }),
    exclude: z
      .object({
        subjects: z.array(z.string()).optional().openapi({
          description:
            "Exclude quads whose subject is in this list. Applied before ranking.",
        }),
        predicates: z.array(z.string()).optional().openapi({
          description:
            "Exclude quads whose predicate is in this list. Applied before ranking.",
        }),
        graphs: z.array(z.string()).optional().openapi({
          description:
            "Exclude quads whose graph is in this list. Applied before ranking.",
        }),
      })
      .optional()
      .openapi({
        description:
          "Exclude denylist: quads matching these exact subject/predicate/graph values are not candidates.",
      }),
  })
  .openapi("SearchFilter");

export const SearchRequestSchema = z
  .object({
    query: z.string().min(1).openapi({
      description:
        "Natural language or keyword search query to find matching content in the world.",
    }),
    limit: z.number().int().min(1).max(100).optional().default(20).openapi({
      description:
        "Maximum number of results to return (1–100). Defaults to 20. The response is capped at this value after ranking; the engine's internal candidate pool is at least this large.",
    }),
    minScore: z.number().min(0).max(1).optional().openapi({
      description:
        "Override the world's minimum relevance score on the normalized 0–1 scale (1.0 = best). Results below this threshold are omitted after ranking.",
    }),
    filter: SearchFilterSchema.optional().openapi({
      description:
        "Include/exclude quad filters applied before ranking (SDK QuadFilter semantics).",
    }),
  })
  .openapi("SearchRequest");

export const SearchResultSchema = z
  .object({
    id: z.string().openapi({
      description:
        "Stable deterministic identifier for the matched quad and text (shared across backends), used for ranked-list evaluation and deduplication.",
    }),
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
        "Named graph URI the quad belongs to. Absent when the world uses a default graph.",
    }),
    content: z.string().openapi({
      description:
        "Text content of the matched quad, used for display and snippet generation. The single text field replacing the legacy object field.",
    }),
    score: z.number().nullable().openapi({
      description:
        "Relevance score from the search engine on the normalized 0–1 scale (1.0 = best). Null for fallback LIKE search results.",
    }),
    scoreType: z.enum(["rrf", "cosine", "unranked"]).openapi({
      description:
        "Scoring family the score expresses: rrf (reciprocal rank fusion, normalized), cosine (vector similarity), or unranked (fallback results carry no ordering meaning).",
    }),
  })
  .openapi("SearchResult");

export const SearchResponseSchema = z
  .object({
    results: z.array(SearchResultSchema).openapi({
      description: "Ranked search results, best first.",
    }),
    mode: z.enum(["semantic", "keyword", "hybrid", "fallback"]).openapi({
      description:
        "Search mode that actually ran: keyword (full-text), semantic (vector), hybrid (both), or fallback (LIKE) when the primary engine is unavailable.",
    }),
  })
  .openapi("SearchResponse");

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
        "MIME type of the import payload. Supported values: text/turtle, application/trig, application/n-triples, application/n-quads, text/n3, application/json (quad rows), text/plain or application/x-ndjson (text chunks). Defaults to text/turtle.",
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
    worldId: z.string().regex(WORLD_ID_PATTERN).optional().openapi({
      description:
        "Optional world ID to scope the key to a single world. Omit to allow access to all worlds in the namespace.",
    }),
    name: z.string().optional().openapi({
      description:
        "Human-readable label for the key. Helps identify keys in the list.",
    }),
    scopes: z
      .array(z.enum(["data:read", "data:write", "embeddings:admin"]))
      .optional()
      .openapi({
        description:
          'Optional scope grant. Defaults to ["data:read", "data:write"]. Use ["data:read"] for read-only keys. embeddings:admin grants management of the namespace embedding credential and is never part of the default grant.',
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
    worldId: z.string().regex(WORLD_ID_PATTERN).nullable().openapi({
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
    worldId: z.string().regex(WORLD_ID_PATTERN).optional().openapi({
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
  worldId: z
    .string()
    .regex(WORLD_ID_PATTERN)
    .openapi({
      param: { name: "worldId", in: "path", required: true },
      description:
        "The world-api-minted world ID, a w_ prefix and a lowercase ULID.",
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
        "Export format. Supported: application/json (quad rows), text/plain (text chunks), application/n-quads, application/n-triples, text/turtle, application/trig, application/ld+json. Defaults to application/json.",
    }),
  limit: z
    .string()
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      description:
        "Maximum number of quads in this page (a positive integer). Honored by every format. Defaults to 1000 for application/json and text/plain; serialized RDF formats return the whole world when limit is omitted. When more data remains, the response carries an X-Next-Offset header (and nextOffset in JSON bodies).",
    }),
  offset: z
    .string()
    .optional()
    .openapi({
      param: { name: "offset", in: "query" },
      description:
        "Pagination offset (a non-negative integer). Use the X-Next-Offset header, or nextOffset in JSON bodies, from the previous response.",
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

export const EmbeddingCredentialRequestSchema = z
  .object({
    apiKey: z.string().max(512).openapi({
      description:
        "The provider API key. Write-only: it is encrypted at rest and never returned or logged; only a fingerprint and last four characters are exposed.",
    }),
  })
  .openapi("EmbeddingCredentialRequest");

export const EmbeddingCredentialSchema = z
  .object({
    provider: z.enum(EMBEDDING_PROVIDER_IDS).openapi({
      description: "Embedding provider.",
    }),
    status: z.enum(["active", "invalid", "revoked"]).openapi({
      description:
        "active: usable. invalid: the provider rejected the key repeatedly; rotate it. revoked: deleted; worlds fall back to keyword-only search.",
    }),
    fingerprint: z.string().openapi({
      description: "First 8 hex characters of the key's SHA-256, for support.",
    }),
    last4: z.string().openapi({
      description: "Last four characters of the key.",
    }),
    createTime: z.string().openapi({ description: "ISO 8601 creation time." }),
    rotateTime: z.string().optional().openapi({
      description: "ISO 8601 time of the most recent rotation.",
    }),
    revokeTime: z.string().optional().openapi({
      description: "ISO 8601 time the credential was revoked.",
    }),
  })
  .openapi("EmbeddingCredential");

export const EmbeddingProviderListSchema = z
  .object({
    providers: z.array(EmbeddingCredentialSchema).openapi({
      description:
        "One entry per provider the namespace has stored a credential for, newest first, revoked ones included.",
    }),
  })
  .openapi("EmbeddingProviderList");
