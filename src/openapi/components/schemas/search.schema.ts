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

export const SearchWorldsRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["query"],
  properties: {
    sources: {
      type: "array",
      items: { $ref: "#/components/schemas/Source" },
    },
    parent: { type: "string" },
    query: { type: "string" },
    pageSize: { type: "number" },
    pageToken: { type: "string" },
    subjects: { type: "array", items: { type: "string" } },
    predicates: { type: "array", items: { type: "string" } },
    types: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

export const SearchWorldsResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: { $ref: "#/components/schemas/SearchResult" },
    },
    nextPageToken: { type: "string" },
  },
  additionalProperties: false,
};
