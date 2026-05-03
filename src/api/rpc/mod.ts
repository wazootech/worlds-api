// RPC module: protocol handler + HTTP app factory.
// Consumers should import from here rather than individual files.
export { handleRpc } from "./handler.ts";
export type { WorldsRpcRequest, WorldsRpcError } from "#/api/openapi/generated/types.gen.ts";
export { createRpcApp, mountRpcPost } from "./app.ts";
export type { RpcAppOptions } from "./app.ts";
export { loadTransportConfigFromEnv, mergeTransportConfig } from "./transport/env.ts";
export { applyTransportPreset } from "./transport/preset.ts";
export type { TransportConfig } from "./transport/types.ts";
