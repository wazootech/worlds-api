import type { OpenAPIV3_1 } from "openapi-types";

const rpcPathItem: OpenAPIV3_1.PathItemObject = {
  post: {
    summary: "Unified RPC endpoint for worlds.",
    operationId: "worldsRpc",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/RequestEnvelope",
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Success",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ResponseEnvelope",
            },
          },
        },
      },
      "400": {
        description: "RPC error",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorEnvelope",
            },
          },
        },
      },
    },
  },
};

export default { "/rpc": rpcPathItem };
