import type { OpenAPIV3_1 } from "openapi-types";

export const World: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "Metadata for a single world.",
  properties: {
    name: {
      type: "string",
      description: "The canonical resource name.",
    },
    id: {
      type: "string",
      description: "The unique identifier for the world.",
    },
    namespace: {
      type: "string",
      description: "The namespace for the world.",
    },
    displayName: {
      type: "string",
      description: "The display name for the world.",
    },
    description: {
      type: "string",
      description: "The description for the world.",
    },
    createTime: {
      type: "number",
      description: "The creation time for the world.",
    },
  },
};

export const CreateWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "Request to create a new world.",
  required: ["namespace", "id"],
  properties: {
    namespace: {
      type: "string",
      description: "Namespace the world belongs to.",
    },
    id: {
      type: "string",
      description: "Client-chosen unique identifier for the world.",
    },
    displayName: {
      type: "string",
      description: "Human-friendly display name.",
    },
    description: {
      type: "string",
      description: "Optional description of the world.",
    },
  },
  additionalProperties: false,
};

export const CreateWorldResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "Response after successfully creating a world.",
  required: ["world"],
  properties: {
    world: {
      $ref: "#/components/schemas/World",
    },
  },
  additionalProperties: false,
};

export const GetWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "Request to get a world by source.",
  required: ["source"],
  properties: {
    source: { $ref: "#/components/schemas/Source" },
  },
  additionalProperties: false,
};

export const GetWorldResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    world: {
      $ref: "#/components/schemas/World",
    },
  },
};

export const UpdateWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["source"],
  properties: {
    source: { $ref: "#/components/schemas/Source" },
    displayName: { type: "string" },
    description: { type: "string" },
  },
  additionalProperties: false,
};

export const UpdateWorldResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["world"],
  properties: {
    world: { $ref: "#/components/schemas/World" },
  },
  additionalProperties: false,
};

export const DeleteWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["source"],
  properties: {
    source: { $ref: "#/components/schemas/Source" },
  },
  additionalProperties: false,
};

export const DeleteWorldResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export const ListWorldsRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    parent: { type: "string" },
    pageSize: { type: "number" },
    pageToken: { type: "string" },
  },
  additionalProperties: false,
};

export const ListWorldsResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["worlds"],
  properties: {
    worlds: { type: "array", items: { $ref: "#/components/schemas/World" } },
    nextPageToken: { type: "string" },
  },
  additionalProperties: false,
};
