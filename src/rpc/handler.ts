import type { WorldsInterface } from "#/worlds/interfaces.ts";
import type {
  RpcErrorObject,
  WorldsRpcError,
  WorldsRpcRequest,
  WorldsRpcResponse,
} from "#/openapi/generated/types.gen.ts";
import { zWorldsRpcRequest } from "#/openapi/generated/zod.gen.ts";

const ErrorCode = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  INTERNAL: "INTERNAL",
} as const;

function toRpcErrorObject(err: unknown): RpcErrorObject {
  if (err instanceof Error) {
    const message = err.message;
    if (message.includes("World not found")) {
      return { code: ErrorCode.NOT_FOUND, message };
    }
    if (message.includes("World already exists")) {
      return { code: ErrorCode.ALREADY_EXISTS, message };
    }
    return { code: ErrorCode.INTERNAL, message };
  }
return { code: ErrorCode.INTERNAL, message: String(err) };
}

/**
 * handleRpc routes a single /rpc request to the provided WorldsInterface.
 *
 * It returns either a typed success envelope (200) or error envelope (400).
 */
export async function handleRpc(
  worlds: WorldsInterface,
  req: WorldsRpcRequest,
): Promise<WorldsRpcResponse | WorldsRpcError> {
  const parsed = zWorldsRpcRequest.safeParse(req);
  if (!parsed.success) {
    return {
      action: req.action || "unknown",
      error: { code: ErrorCode.INVALID_ARGUMENT, message: "Invalid RPC request" },
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
      case "sparqlQuery": {
        const response = await worlds.sparql(req.request);
        return { action: "sparqlQuery", response };
      }
      default: {
        // Exhaustive guard (should be unreachable with generated types)
        const _never: never = req;
        return _never;
      }
    }
  } catch (err) {
    const error = toRpcErrorObject(err);
    // Preserve the action in the error envelope for discriminated unions.
    return { action: req.action, error } as WorldsRpcError;
  }
}
