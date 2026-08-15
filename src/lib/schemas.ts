import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .openapi("ErrorResponse");

export const WorldResourceSchema = z
  .object({
    name: z.string(),
    uid: z.string(),
    displayName: z.string(),
    state: z.string(),
    storage: z.enum(["libsql-per-world", "legacy-shared-libsql"]).openapi({
      description:
        "Storage backend for the world. libsql-per-world provisions a dedicated per-world Turso/LibSQL database; legacy-shared-libsql points at a shared legacy store.",
    }),
    embeddingModel: z.string(),
    chunkSize: z.number().int(),
    topK: z.number().int(),
    minScore: z.number(),
    createTime: z.string(),
    updateTime: z.string(),
    deleteTime: z.string().optional(),
    expireTime: z.string().optional(),
  })
  .openapi("WorldResource");

export const CreateWorldRequestSchema = z
  .object({
    displayName: z.string().optional(),
    embeddingModel: z.string().optional(),
    chunkSize: z.number().int().positive().optional(),
    topK: z.number().int().positive().optional(),
    minScore: z.number().min(0).max(1).optional(),
  })
  .openapi("CreateWorldRequest");

export const UpdateWorldRequestSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    embeddingModel: z.string().optional(),
    chunkSize: z.number().int().positive().optional(),
    topK: z.number().int().positive().optional(),
    minScore: z.number().min(0).max(1).optional(),
  })
  .openapi("UpdateWorldRequest");

export const SearchRequestSchema = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional().default(20),
    topK: z.number().int().positive().optional(),
    minScore: z.number().min(0).max(1).optional(),
  })
  .openapi("SearchRequest");

export const SearchResultSchema = z
  .object({
    subject: z.string(),
    predicate: z.string(),
    graph: z.string().optional(),
    content: z.string().optional(),
    score: z.number().optional(),
  })
  .openapi("SearchResult");

export const SparqlRequestSchema = z
  .object({
    query: z.string().min(1),
  })
  .openapi("SparqlRequest");

export const ImportRequestSchema = z
  .object({
    data: z.string().min(1),
    contentType: z.string().optional().default("text/turtle"),
  })
  .openapi("ImportRequest");

export const ImportResponseSchema = z
  .object({
    imported: z.object({
      quads: z.number().int(),
      chunks: z.number().int(),
    }),
  })
  .openapi("ImportResponse");

export const QuadSchema = z
  .object({
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    graph: z.string().optional(),
  })
  .openapi("Quad");

export const ExportQuadsResponseSchema = z
  .object({
    quads: z.array(QuadSchema),
    nextOffset: z.number().int().optional(),
  })
  .openapi("ExportQuadsResponse");

export const ApiKeyCreateRequestSchema = z
  .object({
    namespace: z.string().min(1),
    worldId: z.string().optional(),
    name: z.string().optional(),
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
    uid: z.string(),
    token: z.string(),
    name: z.string(),
    namespace: z.string(),
    worldId: z.string().nullable(),
    createTime: z.string(),
  })
  .openapi("ApiKeyCreateResponse");

export const ApiKeyResourceSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    namespace: z.string(),
    worldId: z.string().optional(),
    scopes: z.array(z.string()),
    createTime: z.string(),
  })
  .openapi("ApiKeyResource");

export const worldIdParam = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path", required: true },
    description: "The canonical world_uid, e.g. w_<uuid>.",
  }),
});

export const keyIdParam = z.object({
  keyId: z
    .string()
    .openapi({ param: { name: "keyId", in: "path", required: true } }),
});

export const exportQuery = z.object({
  format: z
    .string()
    .optional()
    .default("application/json")
    .openapi({
      param: { name: "format", in: "query" },
    }),
  limit: z
    .string()
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
    }),
  offset: z
    .string()
    .optional()
    .openapi({
      param: { name: "offset", in: "query" },
    }),
});

export const apiKeysListQuery = z.object({
  namespace: z
    .string()
    .optional()
    .openapi({
      param: { name: "namespace", in: "query" },
    }),
});

export const worldsListQuery = z.object({});
