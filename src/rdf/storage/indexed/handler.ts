import type { WorldReference } from "#/rpc/openapi/generated/types.gen.ts";
import { storedQuadToN3 } from "#/rdf/rdf.ts";
import { skolemizeStoredQuad } from "#/rdf/skolem.ts";
import type { EmbeddingsService } from "#/indexing/embeddings/interface.ts";
import type { ChunkIndex, ChunkRecord } from "#/indexing/storage/interface.ts";
import type { StoredQuad } from "#/rdf/storage/types.ts";
import type { Patch, PatchHandler } from "./types.ts";
import { splitTextRecursive } from "#/indexing/text-splitter.ts";

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
    const toDelete: string[] = [];
    const insertions: { q: StoredQuad; quadId: string; chunks: string[] }[] =
      [];
    const textsToEmbed = new Set<string>();

    // 1. Collect and prepare
    for (const patch of patches) {
      if (patch.deletions?.length) {
        const ids = await Promise.all(
          patch.deletions.map((q) => skolemizeStoredQuad(q)),
        );
        toDelete.push(...ids);
      }

      if (patch.insertions?.length) {
        for (const q of patch.insertions) {
          if (!shouldIndexTriple(q, this.rules)) continue;

          const quadId = await skolemizeStoredQuad(q);
          const rule = this.rules.find((r) =>
            r.predicates.includes(q.predicate)
          );
          const chunks = (rule?.noSplit ?? false)
            ? [q.object]
            : splitTextRecursive(q.object);

          if (chunks.length === 0) continue;

          insertions.push({ q, quadId, chunks });
          for (const text of chunks) {
            textsToEmbed.add(text);
          }
        }
      }
    }

    // 2. Delete existing
    for (const id of toDelete) {
      await this.chunks.deleteChunk(id);
    }

    // 3. Batch embed all unique texts
    const uniqueTexts = Array.from(textsToEmbed);
    const vectors = await this.embeddings.embedBatch(uniqueTexts);
    const textToVec = new Map<string, number[]>();
    uniqueTexts.forEach((t, i) => textToVec.set(t, vectors[i]));

    // 4. Set new chunks
    for (const ins of insertions) {
      const records: ChunkRecord[] = await Promise.all(
        ins.chunks.map(async (text, i) => {
          const vec = textToVec.get(text)!;
          const chunkId = await sha256Hex(`${ins.quadId}:chunk:${i}`);
          return {
            id: chunkId,
            quadId: ins.quadId,
            subject: ins.q.subject,
            predicate: ins.q.predicate,
            text,
            vector: Float32Array.from(vec),
            world: this.world,
          };
        }),
      );

      for (const record of records) {
        await this.chunks.setChunk(record);
      }
    }
  }
}
