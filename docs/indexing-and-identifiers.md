# Indexing and identifiers

This doc captures two frequently-confused concepts:

- **Skolemization for ingestion** (blank nodes → stable IRIs within an imported
  dataset)
- **Stable identifiers for facts / chunks** (content-derived IDs used as keys)

It also documents what gets added to the **chunk search index** and how that
pipeline works.

## Two “skolem” meanings

### 1) Ingest-time blank node skolemization (dataset stability)

RDF blank node identifiers (`_:b0`) are scoped to a source document and should
not be treated as stable identifiers.

During ingest we:

- Parse RDF into quads
- Canonicalize the dataset (RDFC-1.0) so blank node labels are deterministic for
  that snapshot
- Replace any `BlankNode` terms in quads with `NamedNode` IRIs under a
  configured prefix

Code: `src/facts/rdf/ingest.ts` uses `toSkolemizedQuad` + `resolveSkolemPrefix`.

### 2) Content-derived stable IDs (fact / chunk keying)

For storage/indexing keys, we use content-derived opaque identifiers:

- **Fact id**: `skolemizeStoredFact(fact)` → canonicalize the corresponding quad
  (RDFC-1.0) → base64url
- **Chunk id**: derived from the fact id + chunk ordinal (SHA-256)

These IDs are used for deterministic delete/update behavior in the chunk index.

Code: `src/facts/rdf/skolem.ts` (`skolemizeQuad`, `skolemizeStoredFact`), and
`src/facts/storage/index/search-index-handler.ts` (chunk ids).

## What gets indexed (chunked) for search

**Current policy:** a fact is added to the chunk search index **iff** its object
is a non-empty `Literal`. This aligns with the goal: **object values are the
search interest**.

Notes:

- Meta predicates (`rdfs:label`, `rdfs:comment`) are excluded from indexing.
- `NamedNode` / `BlankNode` objects are not embedded or chunked.

Code: `src/facts/storage/index/search-index-handler.ts` (`shouldIndexTriple`).

## Indexing pipeline

1. Fact writes go through `IndexedFactStorage` which emits patches
   (insertions/deletions).
2. `SearchIndexHandler` consumes patches and:
   - Computes fact id (`skolemizeStoredFact`)
   - Chunks the literal object text (`splitTextRecursive`)
   - Embeds each chunk (`EmbeddingsService`)
   - Upserts/deletes chunk records in a per-world `ChunkIndex`
3. Queries go through:
   - `ChunkIndex.search(...)` (backend-specific)
   - `search/chunks-search-engine.ts` for multi-world fan-out + ranking/merge

Backends:

- `src/search/storage/in-memory.ts`
- `src/search/storage/orama.ts`
