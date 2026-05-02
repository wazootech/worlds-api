import type { WorldsInterface } from "#/core/interfaces.ts";
import type {
  RpcError,
  WorldsRpcError,
  WorldsRpcRequest,
  WorldsRpcResponse,
} from "#/api/openapi/generated/types.gen.ts";
import { zWorldsRpcRequest } from "#/api/openapi/generated/zod.gen.ts";
import {
  InvalidArgumentError,
  InvalidPageTokenError,
  SparqlError,
  SparqlSyntaxError,
  SparqlUnsupportedOperationError,
  WorldAlreadyExistsError,
  WorldNotFoundError,
} from "#/core/errors.ts";

const ErrorCode = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  INTERNAL: "INTERNAL",
} as const;

/**
 * Maps caught exceptions to stable {@link RpcError} codes for JSON clients.
 *
 * | Input | `code` |
 * | ----- | ------ |
 * | {@link InvalidArgumentError}, {@link InvalidPageTokenError} | `INVALID_ARGUMENT` |
 * | {@link WorldNotFoundError} | `NOT_FOUND` |
 * | {@link WorldAlreadyExistsError} | `ALREADY_EXISTS` |
 * | {@link SparqlSyntaxError}, {@link SparqlUnsupportedOperationError}, {@link SparqlError} | `INVALID_ARGUMENT` |
 * | Any other `Error` | `INTERNAL` |
 * | Non-Error | `INTERNAL` |
 */
function toRpcError(err: unknown): RpcError {
  if (
    err instanceof InvalidArgumentError || err instanceof InvalidPageTokenError
  ) {
    return { code: ErrorCode.INVALID_ARGUMENT, message: err.message };
  }
  if (err instanceof WorldNotFoundError) {
    return { code: ErrorCode.NOT_FOUND, message: err.message };
  }
  if (err instanceof WorldAlreadyExistsError) {
    return { code: ErrorCode.ALREADY_EXISTS, message: err.message };
  }
  if (
    err instanceof SparqlSyntaxError ||
    err instanceof SparqlUnsupportedOperationError ||
    err instanceof SparqlError
  ) {
    return { code: ErrorCode.INVALID_ARGUMENT, message: err.message };
  }
  if (err instanceof Error) {
    return { code: ErrorCode.INTERNAL, message: err.message };
  }
  return { code: ErrorCode.INTERNAL, message: String(err) };
}

/**
 * Routes one JSON-RPC-shaped request to {@link WorldsInterface}.
 *
 * - Validates the body with `zWorldsRpcRequest`; on failure returns
 *   `{ action, error: { code: INVALID_ARGUMENT, message: "Invalid RPC request" } }`
 *   (HTTP layer typically responds with 400 — see {@link ../server/main.ts}).
 * - Success: `{ action, response }` per discriminated `action`.
 * - Domain failure: `{ action, error }` with `action` preserved for client unions.
 *
 * `exportWorld` encodes bytes as base64 in `response.data` (full buffer in memory).
 */
export async function handleRpc(
  worlds: WorldsInterface,
  req: WorldsRpcRequest,
): Promise<WorldsRpcResponse | WorldsRpcError> {
  const parsed = zWorldsRpcRequest.safeParse(req);
  if (!parsed.success) {
    return {
      action: req.action || "unknown",
      error: {
        code: ErrorCode.INVALID_ARGUMENT,
        message: "Invalid RPC request",
      },
    } as WorldsRpcError;
  }

  try {
    switch (req.action) {
      case "getWorld": {
        const world = await worlds.getWorld(req.request);
        return { action: "getWorld", response: { world: world ?? undefined } };
      }
      case "createWorld": {
        const world = await worlds.createWorld(req.request);
        return { action: "createWorld", response: { world } };
      }
      case "updateWorld": {
        const world = await worlds.updateWorld(req.request);
        return { action: "updateWorld", response: { world } };
      }
      case "deleteWorld": {
        await worlds.deleteWorld(req.request);
        return { action: "deleteWorld", response: {} };
      }
      case "listWorlds": {
        const response = await worlds.listWorlds(req.request);
        return { action: "listWorlds", response };
      }
      case "importWorld": {
        await worlds.import(req.request);
        return { action: "importWorld", response: {} };
      }
      case "exportWorld": {
        const data = await worlds.export(req.request);
        return {
          action: "exportWorld",
          response: {
            data: btoa(String.fromCharCode(...new Uint8Array(data))),
            contentType: req.request.contentType,
          },
        };
      }
      case "searchWorlds": {
        const response = await worlds.search(req.request);
        return { action: "searchWorlds", response };
      }
      case "sparql": {
        const response = await worlds.sparql(req.request);
        return { action: "sparql", response };
      }
      default: {
        // Exhaustive guard (should be unreachable with generated types)
        const _never: never = req;
        return _never;
      }
    }
  } catch (err) {
    const error = toRpcError(err);
    // Preserve the action in the error envelope for discriminated unions.
    return { action: req.action, error } as WorldsRpcError;
  }
}
