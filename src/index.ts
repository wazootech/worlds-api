import app from "./app";
import { fromBindings } from "./env";
import { runPurgeSweep } from "./lib/purge";

export default {
  fetch: app.fetch,
  async scheduled(
    _event: unknown,
    env: unknown,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    ctx.waitUntil(runPurgeSweep(fromBindings(env as Record<string, unknown>)));
  },
};
