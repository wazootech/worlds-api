import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { health } from "./routes/health";
import { worlds } from "./routes/worlds";
import { importExport } from "./routes/import-export";
import { search } from "./routes/search";
import { apiKeys } from "./routes/api-keys";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.onError((err, c) => {
  console.error(err);
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Internal server error",
      },
    },
    500,
  );
});

app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404),
);

app.get("/health", health);
app.route("/", worlds);
app.route("/", importExport);
app.route("/", search);
app.route("/", apiKeys);

export default app;
