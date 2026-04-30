import type { OpenAPIV3_1 } from "openapi-types";

export const SearchResult: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["subject", "predicate", "object", "score", "world"],
  properties: {
    subject: { type: "string" },
    predicate: { type: "string" },
    object: { type: "string" },
    vecRank: { type: ["number", "null"] },
    ftsRank: { type: ["number", "null"] },
    score: { type: "number" },
    world: { $ref: "#/components/schemas/World" },
  },
  additionalProperties: false,
};

export const SearchRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["query"],
  properties: {
    sources: {
      type: "array",
      items: { $ref: "#/components/schemas/Source" },
    },
    parent: { type: "string" },
    query: { type: "string" },
    pageSize: {
      type: "integer",
      format: "int32",
      minimum: 0,
      description:
        "Maximum number of results to return. The server may return fewer than this value. If unspecified or 0, the server will choose a default. The server may cap this value.",
    },
    pageToken: {
      type: "string",
      description:
        "A page token, received from a previous `search` call. Provide this to retrieve the subsequent page. Tokens are opaque.",
    },
    subjects: { type: "array", items: { type: "string" } },
    predicates: { type: "array", items: { type: "string" } },
    types: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

export const SearchResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: { $ref: "#/components/schemas/SearchResult" },
    },
    nextPageToken: {
      type: "string",
      description:
        "A token that can be sent as `pageToken` to retrieve the next page. If this field is omitted, there are no subsequent pages.",
    },
  },
  additionalProperties: false,
};
