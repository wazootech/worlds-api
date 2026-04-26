import type { OpenAPIV3_1 } from "openapi-types";

export const RpcErrorObject: OpenAPIV3_1.SchemaObject = {
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

export const RequestEnvelope: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    { $ref: "#/components/schemas/GetWorldRpcRequest" },
    { $ref: "#/components/schemas/CreateWorldRpcRequest" },
  ],
  discriminator: {
    propertyName: "action",
    mapping: {
      getWorld: "#/components/schemas/GetWorldRpcRequest",
      createWorld: "#/components/schemas/CreateWorldRpcRequest",
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

export const ResponseEnvelope: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    { $ref: "#/components/schemas/GetWorldRpcResponse" },
    { $ref: "#/components/schemas/CreateWorldRpcResponse" },
  ],
  discriminator: {
    propertyName: "action",
    mapping: {
      getWorld: "#/components/schemas/GetWorldRpcResponse",
      createWorld: "#/components/schemas/CreateWorldRpcResponse",
    },
  },
};

export const GetWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "getWorld" },
    error: { $ref: "#/components/schemas/RpcErrorObject" },
  },
  additionalProperties: false,
};

export const CreateWorldRpcError: OpenAPIV3_1.SchemaObject = {
  type: "object",
  required: ["action", "error"],
  properties: {
    action: { type: "string", const: "createWorld" },
    error: { $ref: "#/components/schemas/RpcErrorObject" },
  },
  additionalProperties: false,
};

export const ErrorEnvelope: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    { $ref: "#/components/schemas/GetWorldRpcError" },
    { $ref: "#/components/schemas/CreateWorldRpcError" },
  ],
  discriminator: {
    propertyName: "action",
    mapping: {
      getWorld: "#/components/schemas/GetWorldRpcError",
      createWorld: "#/components/schemas/CreateWorldRpcError",
    },
  },
};