import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { storedQuadToN3 } from "#/rdf/rdf.ts";
import { skolemizeStoredQuad } from "#/rdf/skolem.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import type { ChunkIndex, ChunkRecord } from "#/indexing/storage/interface.ts";
import type { StoredQuad } from "#/rdf/storage/types.ts";
import type { Patch, PatchHandler } from "./types.ts";
import { splitTextRecursive } from "./text-splitter.ts";

export interface ChunkingRule {
  /** Predicates this rule applies to (exact IRI match). */
  predicates: string[];
  /** If false, skip indexing for these predicates (opt-out). Default: true. */
  index?: boolean;
  /** If true, skip text splitting and index the full object as one chunk. */
  noSplit?: boolean;
}

/**
 * Whether to embed this triple in the chunk index. Object term type comes only from
 * {@link storedQuadToN3} so it stays aligned with SPARQL round-trip.
 * All predicates are indexed by default; use ChunkingRule with index: false to opt out.
 */
function shouldIndexTriple(
  quad: StoredQuad,
  rules: ChunkingRule[],
): boolean {
  const n3Quad = storedQuadToN3(quad);
  const p = n3Quad.predicate.value;
  const rule = rules.find((r) => r.predicates.includes(p));
  if (rule) return rule.index !== false;
  return n3Quad.object.termType === "Literal" && n3Quad.object.value.length > 0;
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

/**
 * Patch handler: maintains chunk + embedding records for **literal** object
 * values (non-empty). All predicates are indexed by default; use ChunkingRule
 * with `index: false` to opt out. Non-literal objects (NamedNode, BlankNode)
 * are never indexed. Ingest-time blank skolemization vs content-derived
 * quad ids live in `src/rdf/` (`skolemizeStoredQuad`, `src/rdf/materialize.ts`).
 */
export class SearchIndexHandler implements PatchHandler {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunkIndex,
    private readonly world: WorldReference,
    private readonly rules: ChunkingRule[] = [],
  ) {}

  async patch(patches: Patch[]): Promise<void> {
    for (const patch of patches) {
      if (patch.deletions?.length) {
        for (const q of patch.deletions) {
          const quadId = await skolemizeStoredQuad(q);
          await this.chunks.deleteChunk(quadId);
        }
      }

      if (patch.insertions?.length) {
        for (const q of patch.insertions) {
          if (!shouldIndexTriple(q, this.rules)) continue;

          const rule = this.rules.find((r) =>
            r.predicates.includes(q.predicate)
          );
          const noSplit = rule?.noSplit ?? false;

          const quadId = await skolemizeStoredQuad(q);
          const subject = q.subject;
          const predicate = q.predicate;
          const objectText = q.object;

          const fullVector = await this.embeddings.embed(objectText);
          const chunks = noSplit
            ? [objectText]
            : splitTextRecursive(objectText);
          if (chunks.length === 0) continue;

          for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            let chunkVec = Float32Array.from(fullVector);
            if (!noSplit && chunks.length > 1) {
              const v = await this.embeddings.embed(chunkText);
              chunkVec = Float32Array.from(v);
            }

            const chunkId = await sha256Hex(`${quadId}:chunk:${i}`);
            const record: ChunkRecord = {
              id: chunkId,
              quadId,
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
