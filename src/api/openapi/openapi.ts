import type { OpenAPIV3_1 } from "openapi-types";
import { createClient } from "@hey-api/openapi-ts";
import { collectSchemas, importGlob } from "./utils.ts";

const schemasGlob = new URL(
  "./components/schemas/**/*.schema.ts",
  import.meta.url,
);
const schemas = await importGlob(schemasGlob).then((modules) =>
  collectSchemas(modules)
);

export const document: OpenAPIV3_1.Document = {
  openapi: "3.1.0",
  info: {
    title: "Worlds API",
    version: "1.0.0",
    description: "API for managing decentralized, multi-model semantic Worlds.",
  },
  components: {
    schemas,
  },
  paths: {
    "/rpc": {
      post: {
        summary: "Unified RPC endpoint for Worlds.",
        description:
          "JSON body: discriminated `{ action, request }` per `WorldsRpcRequest`. " +
          "Success: HTTP 200 with `{ action, response }`. Any RPC failure (including " +
          "`NOT_FOUND`): HTTP 400 with `{ action, error: { code, message } }` — classify " +
          "RPC failures with `error.code`, not HTTP status alone. With the default " +
          "transport preset (see `src/api/server`), CORS is enabled, JSON body size is " +
          "capped (HTTP **413** when exceeded), and `/rpc` is rate limited (HTTP **429**); " +
          "tune via env or TransportConfig. This stack does **not** authenticate callers — " +
          "add middleware or enforce auth upstream.",
        operationId: "rpc",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/WorldsRpcRequest",
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
                  $ref: "#/components/schemas/WorldsRpcResponse",
                },
              },
            },
          },
          "400": {
            description: "RPC error",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorldsRpcError",
                },
              },
            },
          },
          "413": {
            description:
              "Request body too large (HTTP transport body-size limit)",
          },
          "429": {
            description:
              "Too many requests (HTTP transport rate limiting on `/rpc`)",
          },
        },
      },
    },
  },
};

if (import.meta.main) {
  await createClient([
    {
      input: document,
      output: {
        path: "./src/api/openapi/generated",
        entryFile: false,
      },
      plugins: [
        // https://heyapi.dev/openapi-ts/plugins/typescript
        { name: "@hey-api/typescript" },

        // https://heyapi.dev/openapi-ts/plugins/zod
        { name: "zod" },
      ],
    },
  ]);
}
