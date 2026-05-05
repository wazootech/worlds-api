# Worlds API Context

A context layer for agents providing namespaces (Worlds), RDF data storage, and
semantic search.

## Language

**World**: A namespace containing RDF quads, search indexes, and configuration.
_Avoid_: Space, dataset, graph

**Namespace**: The unique identifier scope for a world (e.g., `user:project`).
_Avoid_: ID, key, path

**Quad**: An RDF statement with subject, predicate, object, and graph. _Avoid_:
Triple

**Chunk**: A text segment derived from quads, indexed for semantic search.
_Avoid_: Segment, fragment

**ChunkIndex**: Storage for chunks with hybrid FTS and vector search
capabilities. _Avoid_: Search index

**DataPlane**: Interface for single-world data operations (SPARQL, Search,
Import). _Avoid_: Data layer

**ManagementPlane**: Interface for world lifecycle operations (Create, List,
Delete). _Avoid_: Control plane

**WorldsInterface**: Unified interface combining DataPlane and ManagementPlane.
_Avoid_: Service, API

**PageToken**: Opaque, signed token encoding pagination state. _Avoid_: Cursor,
offset

## Relationships

- A **World** belongs to exactly one **Namespace**
- A **World** contains zero or more **Quads**
- A **World** has exactly one **ChunkIndex** for search
- **DataPlane** operations target exactly one **World** at a time
- Deleting a **World** atomically cascades to all **Quads** and its
  **ChunkIndex**

## Example dialogue

> **Dev:** "Can I search across all my worlds in a single request?" **Domain
> expert:** "No — the **DataPlane** is strictly single-world scoped. You must
> call `listWorlds` and then search each **World** individually."

> **Dev:** "What happens if a world is deleted while a search is running?"
> **Domain expert:** "Deleting a **World** is atomic. The **Quads** and
> **ChunkIndex** are removed together at the storage level."

## Flagged ambiguities

- "Graph" was used to mean both a **Quad** component and a **World** dataset —
  resolved: "Graph" refers only to the quad component.
- "Search" could mean the demo keyword scanner or the production index —
  resolved: production search requires a **ChunkIndex**.
- "Global Search" was considered but removed — resolved: orchestration is the
  client's responsibility.
