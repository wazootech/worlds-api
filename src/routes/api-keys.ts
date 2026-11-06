import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { registerCreateApiKey } from "./api-keys/handlers-create";
import {
  registerDeleteApiKey,
  registerListApiKeys,
} from "./api-keys/handlers-list-delete";

export function registerApiKeysRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  registerCreateApiKey(app);
  registerListApiKeys(app);
  registerDeleteApiKey(app);
}
