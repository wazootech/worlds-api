import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../env";
import { registerListWorlds, registerGetWorld } from "./worlds/handlers-read";
import { registerCreateWorld } from "./worlds/handlers-create";
import { registerUpdateWorld } from "./worlds/handlers-update";
import {
  registerDeleteWorld,
  registerUndeleteWorld,
} from "./worlds/handlers-delete";
import {
  registerSuspendWorld,
  registerResumeWorld,
} from "./worlds/handlers-suspend";
import {
  registerNamespaceDelete,
  registerPurge,
} from "./worlds/handlers-admin";

export function registerWorldsRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  registerListWorlds(app);
  registerCreateWorld(app);
  registerGetWorld(app);
  registerUpdateWorld(app);
  registerDeleteWorld(app);
  registerUndeleteWorld(app);
  registerSuspendWorld(app);
  registerResumeWorld(app);
  registerNamespaceDelete(app);
  registerPurge(app);
}
