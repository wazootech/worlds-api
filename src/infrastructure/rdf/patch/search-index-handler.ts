import type { WorldReference } from "#/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/infrastructure/embeddings/interface.ts";
import type { ChunkStorage } from "#/infrastructure/chunks/interface.ts";
import type { ChunkRecord } from "#/infrastructure/chunks/types.ts";
import type { StoredQuad } from "#/worlds/store/quad/types.ts";
import { META_PREDICATES, RDF_TYPE } from "#/worlds/rdf/vocab.ts";
import type { Patch, PatchHandler } from "./types.ts";
import { skolemizeStoredQuad } from "./skolem.ts";
import { splitTextRecursive } from "./text-splitter.ts";

function isMetaPredicate(p: string): boolean {
  return META_PREDICATES.includes(p);
}

/** Align with `storeFromQuads` in rdf.ts: literals are not IRIs. */
function shouldIndexTriple(quad: StoredQuad): boolean {
  const obj = quad.object;
  if (quad.predicate === RDF_TYPE) {
    return obj.length > 0;
  }
  const objectTermType = quad.objectTermType ??
    (obj.startsWith("_:")
      ? "BlankNode"
      : obj.includes(":") || obj.startsWith("urn:")
      ? "NamedNode"
      : "Literal");
  return objectTermType === "Literal" && obj.length > 0;
}

async function sha256Hex(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(msg),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class SearchIndexHandler implements PatchHandler {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkStorage,
    private readonly world: WorldReference,
  ) {}

  async patch(patches: Patch[]): Promise<void> {
    for (const patch of patches) {
      if (patch.deletions?.length) {
        for (const q of patch.deletions) {
          const factId = await skolemizeStoredQuad(q);
          await this.chunks.deleteByFactId(this.world, factId);
        }
      }

      if (patch.insertions?.length) {
        for (const q of patch.insertions) {
          if (!shouldIndexTriple(q)) continue;
          if (isMetaPredicate(q.predicate)) continue;

          const tripleId = await skolemizeStoredQuad(q);
          const subject = q.subject;
          const predicate = q.predicate;
          const objectText = q.object;

          const fullVector = await this.embeddings.embed(objectText);
          const chunks = splitTextRecursive(objectText);
          if (chunks.length === 0) continue;

          for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            let chunkVec = Float32Array.from(fullVector);
            if (chunks.length > 1) {
              const v = await this.embeddings.embed(chunkText);
              chunkVec = Float32Array.from(v);
            }

            const chunkId = await sha256Hex(`${tripleId}:chunk:${i}`);
            const record: ChunkRecord = {
              id: chunkId,
              factId: tripleId,
              subject,
              predicate,
              text: chunkText,
              vector: chunkVec,
              world: this.world,
            };
            await this.chunks.upsert(record);
          }
        }
      }

      await this.chunks.markWorldIndexed({
        world: this.world,
        indexedAt: Date.now(),
        embeddingDimensions: this.embeddings.dimensions,
      });
    }
  }
}
