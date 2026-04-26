import type {
  WorldsRpcError,
  WorldsRpcRequest,
  WorldsRpcResponse,
} from "./generated/types.ts";

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
