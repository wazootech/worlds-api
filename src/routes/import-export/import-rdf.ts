import type { Context } from "hono";
import { parseTurtleQuads } from "@wazoo/sparql-engine";
import { respond } from "../../lib/respond";
import { RDF_IMPORT_CONTENT_TYPES } from "./constants";
import type { WorldSdk } from "./import-branches";

export async function importRdf(
  c: Context,
  client: WorldSdk,
  data: string,
  mediaType: string,
  quadsCap: number,
) {
  let quads;
  try {
    quads = parseTurtleQuads(data);
  } catch (error) {
    return respond(
      c,
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: `Could not parse ${mediaType}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      },
      400,
    );
  }
  if (quads.length > quadsCap) {
    return respond(
      c,
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: `Import exceeds the ${quadsCap} quad limit per request`,
        },
      },
      413,
    );
  }
  await client.import({ source: { kind: "quads", quads } });
  return respond(c, { imported: { quads: quads.length, chunks: 0 } });
}

export function unsupportedContentType(c: Context, contentType: string) {
  return respond(
    c,
    {
      error: {
        code: "UNSUPPORTED_CONTENT_TYPE",
        message: `Content type '${contentType}' is not supported. Use ${[
          ...RDF_IMPORT_CONTENT_TYPES,
          "application/json",
          "text/plain",
        ].join(", ")}.`,
      },
    },
    400,
  );
}
