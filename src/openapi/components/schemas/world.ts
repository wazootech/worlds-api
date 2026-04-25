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
