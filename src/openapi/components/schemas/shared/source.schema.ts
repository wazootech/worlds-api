import type { OpenAPIV3_1 } from "openapi-types";

export const TransactionMode: OpenAPIV3_1.SchemaObject = {
  type: "string",
  enum: ["write", "read", "deferred"],
  description: "Transaction behavior for source access.",
};

/**
 * Canonical world name.
 *
 * Format: "{namespace}/{id}"
 */
export const WorldName: OpenAPIV3_1.SchemaObject = {
  type: "string",
  description: "Canonical world name in the form `{namespace}/{id}`.",
  // Two non-empty path segments separated by a single slash.
  // We intentionally reject leading/trailing slashes and extra segments.
  pattern: "^[^/]+/[^/]+$",
};

/**
 * Canonical world reference.
 */
export const WorldReference: OpenAPIV3_1.SchemaObject = {
  type: "object",
  description: "World reference by namespace and id.",
  required: ["namespace", "id"],
  properties: {
    namespace: { type: "string" },
    id: { type: "string" },
  },
  additionalProperties: false,
};

export const Source: OpenAPIV3_1.SchemaObject = {
  description:
    "A source identifier or an object describing a source. For worlds, this is either a canonical world name (`{namespace}/{id}`) or a world ref (`{namespace, id}`).",
  oneOf: [
    { $ref: "#/components/schemas/WorldName" },
    {
      allOf: [
        { $ref: "#/components/schemas/WorldReference" },
        {
          type: "object",
          properties: {
            mode: { $ref: "#/components/schemas/TransactionMode" },
          },
          additionalProperties: false,
        },
      ],
    },
  ],
};
