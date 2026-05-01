# Worlds API - Contracts & Invariants

This document defines the stable contracts that all implementations must uphold.
It is the single source of truth for API behavior, error semantics, and storage
invariants.

## Table of Contents

1. [Error Taxonomy](#error-taxonomy)
2. [World Lifecycle](#world-lifecycle)
3. [QuadStorageManager Contract](#quadstoragemanager-contract)
4. [SPARQL Semantics](#sparql-semantics)
5. [Search Paging](#search-paging)

---

## Error Taxonomy

All errors are typed classes exported from `src/errors.ts`. RPC layer
(`src/api/rpc/handler.ts`) maps them to stable error codes.

| Error Class                       | RPC Code           | When Thrown                                                                                         |
| --------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `WorldAlreadyExistsError`         | `ALREADY_EXISTS`   | `createWorld` with existing world                                                                   |
| `WorldNotFoundError`              | `NOT_FOUND`        | `getWorld`, `updateWorld`, `deleteWorld`, `import`, `export`, `sparql`, `search` with missing world |
| `InvalidArgumentError`            | `INVALID_ARGUMENT` | `sparql` with no sources, negative pageSize                                                         |
| `InvalidPageTokenError`           | `INVALID_ARGUMENT` | Invalid or tampered page token                                                                      |
| `SparqlSyntaxError`               | `INVALID_ARGUMENT` | Malformed SPARQL, query timeout                                                                     |
| `SparqlUnsupportedOperationError` | `INVALID_ARGUMENT` | CONSTRUCT/DESCRIBE, multi-source UPDATE                                                             |

### RPC Error Envelope

```typescript
{
  action: string;
  error: {
    code: string;
    message: string;
  }
}
```

The `action` field is always preserved from the request, enabling discriminated
unions.

---

## World Lifecycle

### Contracts

| Operation     | Behavior                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| `createWorld` | Atomic check+create. Throws `WorldAlreadyExistsError` if world exists.                   |
| `getWorld`    | Returns `World \| null`. Null if not found.                                              |
| `updateWorld` | Partial update (displayName, description). Throws `WorldNotFoundError` if world missing. |
| `deleteWorld` | Idempotent. Deletes storage + quad storage. No-op if world missing.                      |
| `listWorlds`  | Ordered by `namespace` then `id`. Supports pagination.                                   |

### Paging

- Opaque tokens (base64url-encoded JSON with HMAC signature)
- Token binds to request params (parent namespace). Mismatch →
  `InvalidPageTokenError`.
- Default page size: 50. Max: 100.

---

## QuadStorageManager Contract

Defined in `src/rdf/storage/quad-storage.ts` JSDoc.

### QuadStorageManager

| Invariant                | Description                                  |
| ------------------------ | -------------------------------------------- |
| `getQuadStorage(ref)`    | Returns same instance for same ref (cached). |
| `deleteQuadStorage(ref)` | Idempotent. No-op for missing worlds.        |

### QuadStorage

| Invariant                    | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| Quad identity                | Based on `storedQuadKey` (subject+predicate+object+graph). |
| `setQuad` / `setQuads`       | Duplicates (by key) silently ignored (idempotent).         |
| `deleteQuad` / `deleteQuads` | Missing quads silently ignored (idempotent).               |
| `clear()`                    | Removes all quads for this world only. Idempotent.         |
| `findQuads([])`              | Returns all quads in this world.                           |
| `findQuads([matchers])`      | Filters by subject/predicate/object/graph prefix match.    |

### Contract Tests

Shared tests in `src/rdf/storage/contract.test.ts`:

- `getQuadStorage` caching
- World isolation
- `setQuad` / `setQuads` store and deduplicate
- `deleteQuad` / `deleteQuads` remove correctly
- `findQuads` with and without matchers
- `clear` removes all quads for that world only
- `clear` is idempotent
- `deleteQuadStorage` clears storage and is idempotent

Both `InMemoryQuadStorageManager` and `IndexedQuadStorageManager` pass all
contract tests.

---

## SPARQL Semantics

### Supported Query Types

| Type                   | Support | Response Shape                              |
| ---------------------- | ------- | ------------------------------------------- |
| SELECT                 | ✅      | `{ head: { vars, link }, bindings: [...] }` |
| ASK                    | ✅      | `{ head: { link }, boolean: bool }`         |
| UPDATE (single source) | ✅      | `null` (mutates quad storage + index)       |
| UPDATE (multi-source)  | ❌      | Throws `SparqlUnsupportedOperationError`    |
| CONSTRUCT / DESCRIBE   | ❌      | Throws `SparqlUnsupportedOperationError`    |

### UPDATE Semantics

- **Single source only**: UPDATE operates on `references[0]`.
- Diff-based: compares quad storage before/after, applies `deleteQuads` +
  `setQuads`.
- Chunk index is updated via `IndexedQuadStorage` patch handlers.
- Timeout: 30s default (configurable via `options.timeoutMs`).

### Error Handling

- Malformed queries → `SparqlSyntaxError`
- Timeouts → `SparqlSyntaxError("SPARQL query timed out")`
- Unsupported operations → `SparqlUnsupportedOperationError`

---

## Search Paging

### Deterministic Ordering

Search results are sorted by a stable tiebreaker chain to ensure offset paging
is consistent:

```typescript
(b.ftsRank! - a.ftsRank!) ||
  (b.score - a.score) ||
  ((a.world.name ?? "").localeCompare(b.world.name ?? "")) ||
  ((a.subject ?? "").localeCompare(b.subject ?? "")) ||
  ((a.predicate ?? "").localeCompare(b.predicate ?? "")) ||
  ((a.object ?? "").localeCompare(b.object ?? ""));
```

This applies to both:

- **Indexed search** (`searchChunks` in `src/indexing/chunks-search-engine.ts`)
- **Naive FTS** (`searchNaiveFts` in `src/core/worlds.ts`)

### Paging Tokens

- Same opaque token scheme as `listWorlds`
- Token binds to: query, sources, subjects, predicates, types
- Default page size: 20. Max: 100.

---

## Versioning

- This contract document applies to `@worlds/worlds-api` v0.0.x (pre-release).
- Breaking changes to contracts will be flagged in release notes.
- New capabilities (e.g., multi-source UPDATE) will be added as MINOR version
  bumps.
