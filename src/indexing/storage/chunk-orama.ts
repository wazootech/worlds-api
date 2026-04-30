import { create, type Orama, type Vector } from "@orama/orama";

/**
 * Compile-time schema shape passed to `create()` for chunk indexes.
 * Matches stored fields plus Orama vector typing (`vector[N]` strings).
 *
 * Keeping schema construction and `create()` in one module avoids repeating literals
 * and keeps `Orama<ChunkOramaSchemaShape>` flowing from a single typed factory.
 */
export type ChunkOramaSchemaShape = {
  id: "string";
  quadId: "string";
  subject: "string";
  predicate: "string";
  text: "string";
  vector: Vector;
  vector_blob: "number[]";
};

export function chunkOramaSchema(dimensions: number): ChunkOramaSchemaShape {
  return {
    id: "string",
    quadId: "string",
    subject: "string",
    predicate: "string",
    text: "string",
    vector: `vector[${dimensions}]` as Vector,
    vector_blob: "number[]",
  };
}

/** Single place that runs `create({ schema })` for per-world chunk Orama instances. */
export async function createChunkOrama(
  dimensions: number,
): Promise<Orama<ChunkOramaSchemaShape>> {
  return create({ schema: chunkOramaSchema(dimensions) });
}

export type ChunkOrama = Awaited<ReturnType<typeof createChunkOrama>>;
