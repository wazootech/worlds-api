import { expandGlob } from "@std/fs/expand-glob";
import { toFileUrl } from "@std/path/to-file-url";
import { OpenAPIHono } from "@hono/zod-openapi";

const app = new OpenAPIHono();

for await (
  const entry of expandGlob("**/*.ts", { root: "./src/api/v1" })
) {
  const module = await import(toFileUrl(entry.path).href);
  app.route("/v1", module.app);
}

app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    version: "0.0.1",
    title: "Worlds API",
  },
});

export default app satisfies Deno.ServeDefaultExport;
