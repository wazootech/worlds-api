import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../../env";
import { newWorldId } from "../../lib/db";
import {
  authorize,
  requireAccess,
  SCOPE_DATA_WRITE,
  unauthorized,
} from "../../lib/auth";
import { provisionWorld } from "../../lib/d1-provision";
import { setInferenceSetting } from "../../lib/inference";
import { getCredentialForModel } from "../../lib/embeddings/store";
import { respond } from "../../lib/respond";
import { createRouteDef } from "./routes-write";
import { statusFor, worldResource, type WorldRow } from "./shared";

export function registerCreateWorld(app: OpenAPIHono<{ Bindings: Env }>) {
  app.openapi(createRouteDef, async (c) => {
    const env = c.env as unknown as Env;
    const auth = await authorize(c.req.raw, env);
    const body = c.req.valid("json");

    const namespace = auth.namespace;
    if (!namespace) {
      if (!auth.admin) return unauthorized();
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "A namespace-scoped API key is required to create a world",
          },
        },
        400,
      );
    }
    const accessErr = requireAccess(
      auth,
      namespace,
      undefined,
      SCOPE_DATA_WRITE,
    );
    if (accessErr) return accessErr;

    // Same rule as PATCH: choosing a model needs a usable credential.
    if (body.embeddingModel !== undefined) {
      const credential = await getCredentialForModel(
        env,
        namespace,
        body.embeddingModel,
      );
      if (!credential || credential.status !== "active") {
        return respond(
          c,
          {
            error: {
              code: "EMBEDDING_CREDENTIAL_REQUIRED",
              message:
                "Set an active embedding credential for the namespace before choosing an embedding model",
            },
          },
          409,
        );
      }
    }

    const worldId = newWorldId();

    const metadata = await provisionWorld(env, worldId, namespace, {
      displayName: body.displayName,
      embeddingModel: body.embeddingModel,
      chunkSize: body.chunkSize,
      topK: body.topK,
      minScore: body.minScore,
    });
    if (body.inference) {
      await setInferenceSetting(env, worldId, body.inference);
    }

    return respond(
      c,
      worldResource(
        metadata as WorldRow,
        await statusFor(env, metadata as WorldRow),
        body.inference,
      ),
      201,
    );
  });
}
