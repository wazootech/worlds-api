import app from "./app";
import { fromBindings } from "./env";
import { runPurgeSweep } from "./lib/purge";
import {
  ensureControlPlaneSchema,
  ensurePerWorldSchema,
} from "./lib/d1-schema";

export default {
  fetch: app.fetch,
  async scheduled(
    _event: unknown,
    env: unknown,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    const bindings = fromBindings(env as Record<string, unknown>);
    ctx.waitUntil(
      ensureControlPlaneSchema(bindings.DB)
        .then(() => ensurePerWorldSchema(bindings.DB))
        .then(() => runPurgeSweep(bindings)),
    );
  },
};
