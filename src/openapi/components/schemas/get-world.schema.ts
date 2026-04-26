import type { OpenAPIV3_1 } from "openapi-types";

export const GetWorldRequest: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "Request to get a world by name.",
  required: ["name"],
  properties: {
    name: {
      type: "string",
      description: "The canonical resource name.",
    }
  },
};


export const GetWorldResponse: OpenAPIV3_1.SchemaObject = {
      type: "object",
      properties: {
        world: {
          $ref: "#/components/schemas/World",
        }
      },
};