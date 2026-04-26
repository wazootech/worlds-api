import type { OpenAPIV3_1 } from "openapi-types";

export const TransactionMode: OpenAPIV3_1.SchemaObject = {
  type: "string",
  enum: ["write", "read", "deferred"],
  description: "Transaction behavior for source access.",
};

export const Source: OpenAPIV3_1.SchemaObject = {
  description: "A source identifier or an object describing a source.",
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        name: { type: "string" },
        id: { type: "string" },
        namespace: { type: "string" },
        mode: { $ref: "#/components/schemas/TransactionMode" },
      },
      additionalProperties: false,
    },
  ],
};
