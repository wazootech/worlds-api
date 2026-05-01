import type { OpenAPIV3_1 } from "openapi-types";

export const SparqlValue: OpenAPIV3_1.SchemaObject = {
  description: "A value in a SPARQL result.",
  oneOf: [
    {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", const: "uri" },
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", const: "bnode" },
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", const: "literal" },
        value: { type: "string" },
        "xml:lang": { type: "string" },
        datatype: { type: "string" },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", const: "triple" },
        value: {
          type: "object",
          required: ["subject", "predicate", "object"],
          properties: {
            subject: { $ref: "#/components/schemas/SparqlValue" },
            predicate: { $ref: "#/components/schemas/SparqlValue" },
            object: { $ref: "#/components/schemas/SparqlValue" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  ],
};

export const SparqlSelectResults: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["head", "results"],
  properties: {
    head: {
      type: "object",
      required: ["vars"],
      properties: {
        vars: { type: "array", items: { type: "string" } },
        link: { type: ["array", "null"], items: { type: "string" } },
      },
      additionalProperties: false,
    },
    results: {
      type: "object",
      required: ["bindings"],
      properties: {
        bindings: { type: "array", items: { type: "object" } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const SparqlAskResults: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["head", "boolean"],
  properties: {
    head: {
      type: "object",
      properties: {
        link: { type: ["array", "null"], items: { type: "string" } },
      },
      additionalProperties: false,
    },
    boolean: { type: "boolean" },
  },
  additionalProperties: false,
};

export const SparqlQuad: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["subject", "predicate", "object", "graph"],
  properties: {
    subject: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", enum: ["uri", "bnode"] },
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    predicate: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", const: "uri" },
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    object: { $ref: "#/components/schemas/SparqlValue" },
    graph: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", enum: ["default", "uri"] },
        value: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const SparqlQuadsResults: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["head", "results"],
  properties: {
    head: {
      type: "object",
      properties: {
        link: { type: ["array", "null"], items: { type: "string" } },
      },
      additionalProperties: false,
    },
    results: {
      type: "object",
      required: ["quads"],
      properties: {
        quads: {
          type: "array",
          items: { $ref: "#/components/schemas/SparqlQuad" },
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const SparqlRequest: OpenAPIV3_1.SchemaObject = {
  description: "SPARQL query or update operation.",
  type: "object",
  required: ["query"],
  properties: {
    sources: {
      type: "array",
      items: { $ref: "#/components/schemas/Source" },
    },
    parent: { type: "string" },
    query: { type: "string" },
    defaultGraphUris: { type: "array", items: { type: "string" } },
    namedGraphUris: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

export const SparqlResponse: OpenAPIV3_1.SchemaObject = {
  description: "Result of a SPARQL query or update operation.",
  oneOf: [
    { $ref: "#/components/schemas/SparqlSelectResults" },
    { $ref: "#/components/schemas/SparqlAskResults" },
    { type: "null" },
  ],
};

export const SparqlBinding: OpenAPIV3_1.SchemaObject = {
  type: "object",
  additionalProperties: { $ref: "#/components/schemas/SparqlValue" },
};
