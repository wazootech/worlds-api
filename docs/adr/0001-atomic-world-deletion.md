# ADR 0001: Atomic World Deletion via Cascades

## Status

Accepted

## Context

A **World** in the Worlds API is a composite entity consisting of metadata
(world name, description), RDF data (**Quads**), and a search index
(**ChunkIndex**). Currently, these layers are managed by separate storage
components. When a world is deleted, all associated data must be removed to
prevent orphans and ensure consistency.

## Decision

We will leverage database-level **`ON DELETE CASCADE`** foreign key constraints
in our production **libSQL** storage implementation.

- All world data (metadata, quads, and chunks) for a given system instance will
  reside in a single libSQL database file.
- The `worlds` table will be the parent. The `quads` and `chunks` tables will
  have foreign keys to the `worlds` table.
- Orchestration in the `Worlds` service will be simplified to a single delete
  call to the metadata layer.

## Consequences

- **Atomicity**: Deletion is guaranteed to be atomic by the database engine.
- **Simplicity**: Reduced application-level cleanup logic and edge-case handling
  for partial deletions.
- **Coupling**: The storage layers become coupled by a shared database
  client/connection, which is acceptable given our "Single Storage Client"
  strategy for libSQL.
