import type { WorldsInterface } from "./interfaces.ts";
import type {
  RpcErrorObject,
  WorldsRpcError,
  WorldsRpcRequest,
  WorldsRpcResponse,
} from "./generated/types.gen.ts";

/**
 * RpcRequest is a typed RPC request envelope for a specific action.
 */
export type RpcRequest<TAction extends WorldsRpcRequest["action"]> = Extract<
  WorldsRpcRequest,
  { action: TAction }
>;

/**
 * RpcResponse is a typed RPC success envelope for a specific action.
 */
export type RpcResponse<TAction extends WorldsRpcResponse["action"]> = Extract<
  WorldsRpcResponse,
  { action: TAction }
>;

/**
 * RpcError is a typed RPC error envelope for a specific action.
 */
export type RpcError<TAction extends WorldsRpcError["action"]> = Extract<
  WorldsRpcError,
  { action: TAction }
>;

function toRpcErrorObject(err: unknown): RpcErrorObject {
  if (err instanceof Error) {
    return { code: "INTERNAL", message: err.message };
  }
  return { code: "INTERNAL", message: String(err) };
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
