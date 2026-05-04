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
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Key",
        description:
          "API key for authentication. Obtain via your dashboard or admin API. " +
          "The key is verified on every request and scopes the Worlds instance to the owner.",
      },
    },
    schemas,
  },
  security: [{ apiKey: [] }],
  paths: {
    "/rpc": {
      post: {
        summary: "Unified RPC endpoint for Worlds.",
        description:
          "JSON body: discriminated `{ action, request }` per `WorldsRpcRequest` (OpenAPI). " +
          "This is **not** [JSON-RPC 2.0](https://www.jsonrpc.org/specification): there is no " +
          "`jsonrpc` version field, `id`, or `params`/`result` in the spec sense. " +
          "Success: HTTP 200 with `{ action, response }`. RPC failures return " +
          "`{ action, error: { code, message } }` with HTTP status derived from `error.code` " +
          "(e.g. 404 for `NOT_FOUND`, 400 for `INVALID_ARGUMENT`, 500 for `INTERNAL`); " +
          "classify failures with `error.code`, not HTTP status alone. With the default " +
          "transport preset (see `src/rpc/transport`), CORS is enabled, JSON body size is " +
          "capped (HTTP **413** when exceeded), and `/rpc` is rate limited (HTTP **429**); " +
          "tune via env or TransportConfig. Auth is enforced via API keys — " +
          "include `X-Api-Key` header on every request; missing/invalid keys return HTTP **401** " +
          "(RPC code `UNAUTHENTICATED`), and unauthorized access returns HTTP **403** (RPC code `PERMISSION_DENIED`).",
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
            description:
              "RPC error (e.g., INVALID_ARGUMENT, default for RPC-level failures)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorldsRpcError",
                },
              },
            },
          },
          "401": {
            description:
              "Unauthenticated — missing or invalid API key (RPC code UNAUTHENTICATED)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorldsRpcError",
                },
              },
            },
          },
          "403": {
            description:
              "Permission denied — user does not own the resource (RPC code PERMISSION_DENIED)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorldsRpcError",
                },
              },
            },
          },
          "404": {
            description: "Resource not found (RPC code NOT_FOUND)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorldsRpcError",
                },
              },
            },
          },
          "409": {
            description: "Resource already exists (RPC code ALREADY_EXISTS)",
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
          "500": {
            description: "Internal error (RPC code INTERNAL)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorldsRpcError",
                },
              },
            },
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
        path: "./src/rpc/openapi/generated",
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
