import type { WorldReference } from "#/api/openapi/generated/types.gen.ts";
import { storedFactToN3 } from "#/facts/rdf/rdf.ts";
import { skolemizeStoredFact } from "#/facts/rdf/skolem.ts";
import { META_PREDICATES } from "#/facts/rdf/vocab.ts";
import type { EmbeddingsService } from "#/search/embeddings/interface.ts";
import type { ChunkIndex, ChunkRecord } from "#/search/storage/interface.ts";
import type { StoredFact } from "#/facts/storage/types.ts";
import type { Patch, PatchHandler } from "./types.ts";
import { splitTextRecursive } from "./text-splitter.ts";

function isMetaPredicate(predicate: string): boolean {
  return META_PREDICATES.includes(predicate);
}

/**
 * Whether to embed this triple in the chunk index. Object term type comes only from
 * {@link storedFactToN3} so it stays aligned with SPARQL round-trip.
 */
function shouldIndexTriple(fact: StoredFact): boolean {
  const quad = storedFactToN3(fact);
  const p = quad.predicate.value;
  if (isMetaPredicate(p)) return false;
  return quad.object.termType === "Literal" && quad.object.value.length > 0;
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
