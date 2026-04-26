import type { OpenAPIV3_1 } from "openapi-types";

export const RpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "Error payload for RPC failures.",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    details: {
      description: "Optional structured error details.",
      type: "object",
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export const GetWorldRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "getWorld" },
    request: { $ref: "#/components/schemas/GetWorldRequest" },
  },
  additionalProperties: false,
};

export const CreateWorldRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "createWorld" },
    request: { $ref: "#/components/schemas/CreateWorldRequest" },
  },
  additionalProperties: false,
};

export const UpdateWorldRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "updateWorld" },
    request: { $ref: "#/components/schemas/UpdateWorldRequest" },
  },
  additionalProperties: false,
};

export const DeleteWorldRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "deleteWorld" },
    request: { $ref: "#/components/schemas/DeleteWorldRequest" },
  },
  additionalProperties: false,
};

export const ListWorldsRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "listWorlds" },
    request: { $ref: "#/components/schemas/ListWorldsRequest" },
  },
  additionalProperties: false,
};

export const ImportWorldRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "importWorld" },
    request: { $ref: "#/components/schemas/ImportWorldRequest" },
  },
  additionalProperties: false,
};

export const ExportWorldRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "exportWorld" },
    request: { $ref: "#/components/schemas/ExportWorldRequest" },
  },
  additionalProperties: false,
};

export const SearchWorldsRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "searchWorlds" },
    request: { $ref: "#/components/schemas/SearchRequest" },
  },
  additionalProperties: false,
};

export const SparqlRpcRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "request"],
  properties: {
    action: { type: "string", const: "sparql" },
    request: { $ref: "#/components/schemas/SparqlQueryRequest" },
  },
  additionalProperties: false,
};

export const WorldsRpcRequest: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    { $ref: "#/components/schemas/GetWorldRpcRequest" },
    { $ref: "#/components/schemas/CreateWorldRpcRequest" },
    { $ref: "#/components/schemas/UpdateWorldRpcRequest" },
    { $ref: "#/components/schemas/DeleteWorldRpcRequest" },
    { $ref: "#/components/schemas/ListWorldsRpcRequest" },
    { $ref: "#/components/schemas/ImportWorldRpcRequest" },
    { $ref: "#/components/schemas/ExportWorldRpcRequest" },
    { $ref: "#/components/schemas/SearchWorldsRpcRequest" },
    { $ref: "#/components/schemas/SparqlRpcRequest" },
  ],
  discriminator: {
    propertyName: "action",
    mapping: {
      getWorld: "#/components/schemas/GetWorldRpcRequest",
      createWorld: "#/components/schemas/CreateWorldRpcRequest",
      updateWorld: "#/components/schemas/UpdateWorldRpcRequest",
      deleteWorld: "#/components/schemas/DeleteWorldRpcRequest",
      listWorlds: "#/components/schemas/ListWorldsRpcRequest",
      importWorld: "#/components/schemas/ImportWorldRpcRequest",
      exportWorld: "#/components/schemas/ExportWorldRpcRequest",
      searchWorlds: "#/components/schemas/SearchWorldsRpcRequest",
      sparql: "#/components/schemas/SparqlRpcRequest",
    },
  },
};

export const GetWorldRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "getWorld" },
    response: { $ref: "#/components/schemas/GetWorldResponse" },
  },
  additionalProperties: false,
};

export const CreateWorldRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "createWorld" },
    response: { $ref: "#/components/schemas/CreateWorldResponse" },
  },
  additionalProperties: false,
};

export const UpdateWorldRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "updateWorld" },
    response: { $ref: "#/components/schemas/UpdateWorldResponse" },
  },
  additionalProperties: false,
};

export const DeleteWorldRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "deleteWorld" },
    response: { $ref: "#/components/schemas/DeleteWorldResponse" },
  },
  additionalProperties: false,
};

export const ListWorldsRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "listWorlds" },
    response: { $ref: "#/components/schemas/ListWorldsResponse" },
  },
  additionalProperties: false,
};

export const ImportWorldRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "importWorld" },
    response: { $ref: "#/components/schemas/ImportWorldResponse" },
  },
  additionalProperties: false,
};

export const ExportWorldRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "exportWorld" },
    response: { $ref: "#/components/schemas/ExportWorldResponse" },
  },
  additionalProperties: false,
};

export const SearchWorldsRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "searchWorlds" },
    response: { $ref: "#/components/schemas/SearchResponse" },
  },
  additionalProperties: false,
};

export const SparqlRpcResponse: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "response"],
  properties: {
    action: { type: "string", const: "sparql" },
    response: { $ref: "#/components/schemas/SparqlQueryResponse" },
  },
  additionalProperties: false,
};

export const WorldsRpcResponse: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    { $ref: "#/components/schemas/GetWorldRpcResponse" },
    { $ref: "#/components/schemas/CreateWorldRpcResponse" },
    { $ref: "#/components/schemas/UpdateWorldRpcResponse" },
    { $ref: "#/components/schemas/DeleteWorldRpcResponse" },
    { $ref: "#/components/schemas/ListWorldsRpcResponse" },
    { $ref: "#/components/schemas/ImportWorldRpcResponse" },
    { $ref: "#/components/schemas/ExportWorldRpcResponse" },
    { $ref: "#/components/schemas/SearchWorldsRpcResponse" },
    { $ref: "#/components/schemas/SparqlRpcResponse" },
  ],
  discriminator: {
    propertyName: "action",
    mapping: {
      getWorld: "#/components/schemas/GetWorldRpcResponse",
      createWorld: "#/components/schemas/CreateWorldRpcResponse",
      updateWorld: "#/components/schemas/UpdateWorldRpcResponse",
      deleteWorld: "#/components/schemas/DeleteWorldRpcResponse",
      listWorlds: "#/components/schemas/ListWorldsRpcResponse",
      importWorld: "#/components/schemas/ImportWorldRpcResponse",
      exportWorld: "#/components/schemas/ExportWorldRpcResponse",
      searchWorlds: "#/components/schemas/SearchWorldsRpcResponse",
      sparql: "#/components/schemas/SparqlRpcResponse",
    },
  },
};

export const GetWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "getWorld" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const CreateWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "createWorld" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const UpdateWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "updateWorld" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const DeleteWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "deleteWorld" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const ListWorldsRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "listWorlds" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const ImportWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "importWorld" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const ExportWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "exportWorld" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const SearchWorldsRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "searchWorlds" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const SparqlRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "sparql" },
    error: { $ref: "#/components/schemas/RpcError" },
  },
  additionalProperties: false,
};

export const WorldsRpcError: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    { $ref: "#/components/schemas/GetWorldRpcError" },
    { $ref: "#/components/schemas/CreateWorldRpcError" },
    { $ref: "#/components/schemas/UpdateWorldRpcError" },
    { $ref: "#/components/schemas/DeleteWorldRpcError" },
    { $ref: "#/components/schemas/ListWorldsRpcError" },
    { $ref: "#/components/schemas/ImportWorldRpcError" },
    { $ref: "#/components/schemas/ExportWorldRpcError" },
    { $ref: "#/components/schemas/SearchWorldsRpcError" },
    { $ref: "#/components/schemas/SparqlRpcError" },
  ],
  discriminator: {
    propertyName: "action",
    mapping: {
      getWorld: "#/components/schemas/GetWorldRpcError",
      createWorld: "#/components/schemas/CreateWorldRpcError",
      updateWorld: "#/components/schemas/UpdateWorldRpcError",
      deleteWorld: "#/components/schemas/DeleteWorldRpcError",
      listWorlds: "#/components/schemas/ListWorldsRpcError",
      importWorld: "#/components/schemas/ImportWorldRpcError",
      exportWorld: "#/components/schemas/ExportWorldRpcError",
      searchWorlds: "#/components/schemas/SearchWorldsRpcError",
      sparql: "#/components/schemas/SparqlRpcError",
    },
  },
};
