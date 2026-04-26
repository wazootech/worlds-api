import type { OpenAPIV3_1 } from "openapi-types";

export const ContentType: OpenAPIV3_1.SchemaObject = {
  type: "string",
  description: "Supported RDF serialization content types.",
  enum: [
    "text/turtle",
    "application/n-quads",
    "application/n-triples",
    "text/n3",
  ],
};

export const ImportWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["source", "data"],
  properties: {
    source: { $ref: "#/components/schemas/Source" },
    data: {
      type: "string",
      description: "RDF data to import (can be base64-encoded).",
    },
    contentType: { $ref: "#/components/schemas/ContentType" },
  },
  additionalProperties: false,
};

export const ImportWorldResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export const ExportWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["source"],
  properties: {
    source: { $ref: "#/components/schemas/Source" },
    contentType: { $ref: "#/components/schemas/ContentType" },
  },
  additionalProperties: false,
};

export const ExportWorldResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["data"],
  properties: {
    data: { type: "string" },
    contentType: { $ref: "#/components/schemas/ContentType" },
  },
  additionalProperties: false,
};
