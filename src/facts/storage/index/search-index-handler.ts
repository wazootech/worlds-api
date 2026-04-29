import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import type { EmbeddingsService } from "#/search/embeddings/interface.ts";
import type { ChunkIndex, ChunkRecord } from "#/search/storage/interface.ts";
import type { StoredFact } from "#/facts/storage/types.ts";
import { META_PREDICATES, RDF_TYPE } from "#/facts/rdf/vocab.ts";
import type { Patch, PatchHandler } from "./types.ts";
import { skolemizeStoredFact } from "./skolem.ts";
import { splitTextRecursive } from "./text-splitter.ts";

function isMetaPredicate(p: string): boolean {
  return META_PREDICATES.includes(p);
}

/** Align with `storeFromFacts` in rdf.ts: literals are not IRIs. */
function shouldIndexTriple(fact: StoredFact): boolean {
  const obj = fact.object;
  if (fact.predicate === RDF_TYPE) {
    return obj.length > 0;
  }
  const objectTermType = fact.objectTermType ??
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
    private readonly chunks: ChunkIndex,
    private readonly world: WorldReference,
  ) {}

  async patch(patches: Patch[]): Promise<void> {
    for (const patch of patches) {
      if (patch.deletions?.length) {
        for (const q of patch.deletions) {
          const factId = await skolemizeStoredFact(q);
          await this.chunks.deleteChunk(factId);
        }
      }

      if (patch.insertions?.length) {
        for (const q of patch.insertions) {
          if (!shouldIndexTriple(q)) continue;
          if (isMetaPredicate(q.predicate)) continue;

          const tripleId = await skolemizeStoredFact(q);
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
            await this.chunks.setChunk(record);
          }
        }
      }

      // Index state is management-plane; handled by the caller/manager.
    }
  }
}
