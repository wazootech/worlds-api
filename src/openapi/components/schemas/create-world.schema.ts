import type { OpenAPIV3_1 } from "openapi-types";

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

