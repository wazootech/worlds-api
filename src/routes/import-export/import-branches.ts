import type { Context } from "hono";
import type { getWorldSdk } from "../../lib/world-db";
import { respond } from "../../lib/respond";
import { quadToNQuad, type QuadRow } from "./nquads";

export type WorldSdk = Awaited<ReturnType<typeof getWorldSdk>>;

export async function importJsonQuads(
  c: Context,
  client: WorldSdk,
  data: string,
  quadsCap: number,
) {
  const items = JSON.parse(data) as QuadRow[];
  if (items.length > quadsCap) {
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
  await client.import({
    source: {
      kind: "serialized",
      contentType: "application/n-quads",
      data: items.map(quadToNQuad).join(""),
    },
  });

  return respond(c, { imported: { quads: items.length, chunks: 0 } });
}

export async function importTextChunks(
  c: Context,
  client: WorldSdk,
  data: string,
  quadsCap: number,
) {
  const lines = data
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length > quadsCap) {
    return respond(
      c,
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: `Import exceeds the ${quadsCap} chunk limit per request`,
        },
      },
      413,
    );
  }

  const chunks = lines.map((text, index) => {
    return {
      subject: `urn:wazoo:chunk:${index}`,
      predicate: "http://schema.org/text",
      object: text,
      graph: `urn:wazoo:import:${index}`,
    };
  });

  await client.import({
    source: {
      kind: "serialized",
      contentType: "application/n-quads",
      data: chunks.map(quadToNQuad).join(""),
    },
  });

  return respond(c, {
    imported: { quads: 0, chunks: chunks.length },
  });
}
