# Worlds API - Architecture Diagrams

> **Contracts**: See [CONTRACTS.md](./CONTRACTS.md) for API invariants, error
> taxonomy, and storage contracts.

## Indexing and identifiers

This section captures two frequently-confused concepts:

- **Skolemization for ingestion** (blank nodes → stable IRIs within an imported
  dataset)
- **Stable identifiers for quads / chunks** (content-derived IDs used as keys)

It also documents what gets added to the **chunk search index** and how that
pipeline works.

### Two “skolem” meanings

#### 1) Ingest-time blank node skolemization (dataset stability)

RDF blank node identifiers (`_:b0`) are scoped to a source document and should
not be treated as stable identifiers.

During ingest we:

- Parse RDF into quads
- Canonicalize the dataset (RDFC-1.0) so blank node labels are deterministic for
  that snapshot
- Replace any `BlankNode` terms in quads with `NamedNode` IRIs under a
  configured prefix

Code: `src/rdf/rdf/ingest.ts` uses `toSkolemizedQuad` + `resolveSkolemPrefix`.

#### 2) Content-derived stable IDs (quad / chunk keying)

For storage/indexing keys, we use content-derived opaque identifiers:

- **Quad id**: `skolemizeStoredQuad(quad)` → canonicalize the corresponding quad
  (RDFC-1.0) → base64url
- **Chunk id**: derived from the quad id + chunk ordinal (SHA-256)

These IDs are used for deterministic delete/update behavior in the chunk index.

Code: `src/rdf/rdf/skolem.ts` (`skolemizeQuad`, `skolemizeStoredQuad`), and
`src/indexing/handlers/rdf-write-indexing/search-index-handler.ts` (chunk ids).

### What gets indexed (chunked) for search

**Current policy:** a quad is added to the chunk search index **iff** its object
is a non-empty `Literal`. This aligns with the goal: **object values are the
search interest**.

Notes:

- Meta predicates (`rdfs:label`, `rdfs:comment`) are excluded from indexing.
- `NamedNode` / `BlankNode` objects are not embedded or chunked.

Code: `src/indexing/handlers/rdf-write-indexing/search-index-handler.ts`
(`shouldIndexTriple`).

### Indexing pipeline

1. Quad writes go through `IndexedQuadStorage` which emits patches
   (insertions/deletions).
2. `SearchIndexHandler` consumes patches and:
   - Computes quad id (`skolemizeStoredQuad`)
   - Chunks the literal object text (`splitTextRecursive`)
   - Embeds each chunk (`EmbeddingsService`)
   - Upserts/deletes chunk records in a per-world `ChunkIndex`
3. Queries go through:
   - `ChunkIndex.search(...)` (backend-specific)

- `indexing/chunks-search-engine.ts` for multi-world fan-out + ranking/merge

Backends:

- `src/indexing/storage/in-memory.ts`
- `src/indexing/storage/orama.ts`

## Interface Relationships

```mermaid
classDiagram
    class StoredQuad {
        +string subject
        +string predicate
        +string object
        +string graph
        +string? objectTermType
        +string? objectDatatype
        +string? objectLanguage
    }
    
    class QuadStorage {
        +setQuad(quad: StoredQuad) Promise~void~
        +deleteQuad(quad: StoredQuad) Promise~void~
        +setQuads(quads: StoredQuad[]) Promise~void~
        +deleteQuads(quads: StoredQuad[]) Promise~void~
        +findQuads(matchers: StoredQuad[]) Promise~StoredQuad[]~
        +clear() Promise~void~
    }
    
    class WorldReference {
        +string namespace
        +string id
    }
    
    class QuadStorageManager {
        +getQuadStorage(reference: WorldReference) Promise~QuadStorage~
        +deleteQuadStorage(reference: WorldReference) Promise~void~
    }
    
    class WorldStorage {
        +getWorld(reference: WorldReference) Promise~StoredWorld~
        +updateWorld(world: StoredWorld) Promise~void~
        +deleteWorld(reference: WorldReference) Promise~void~
        +listWorlds(namespace?: string) Promise~StoredWorld[]~
    }
    
    class ChunkIndex {
        +setChunk(chunk: ChunkRecord) Promise~void~
        +deleteChunk(quadId: string) Promise~void~
        +getAll() Promise~ChunkRecord[]~
        +search(input: ChunkIndexSearchQuery) Promise~ChunkSearchRow[]~
    }
    
    class ChunkIndexManager {
        +getChunkIndex(reference: WorldReference) Promise~ChunkIndex~
        +getIndexState(world: WorldReference) Promise~ChunkIndexState~
        +setIndexState(state: ChunkIndexState) Promise~void~
        +deleteChunkIndex(reference: WorldReference) Promise~void~
    }
    
    class EmbeddingsService {
        +dimensions: number
        +embed(text: string) Promise~number[]~
    }
    
    class PatchHandler {
        +patch(patches: Patch[]) Promise~void~
    }
    
    WorldReference --> QuadStorageManager
    WorldReference --> WorldStorage
    WorldReference --> ChunkIndexManager
    
    QuadStorage --> QuadStorageManager: managed by
    ChunkIndexManager --> QuadStorageManager: indexed by
    EmbeddingsService --> QuadStorageManager: vectorized by
    PatchHandler --> QuadStorage: wraps
    
    QuadStorageManager "1" *-- "many" QuadStorage: creates
```

## Data Flow - Search Index Pipeline

```mermaid
sequenceDiagram
    participant Client
    participant Worlds
    participant QuadStorageManager
    participant IndexedQuadStorage
    participant SearchIndexHandler
    participant EmbeddingsService
    participant ChunkIndex
    participant ChunkIndexManager
    
    Client->>Worlds: sparql UPDATE (INSERT/DELETE)
    Worlds->>QuadStorageManager: getQuadStorage(ref)
    QuadStorageManager-->>IndexedQuadStorage: returns
    
    Note over IndexedQuadStorage: Applies quad changes<br/>then notifies handlers
    
    IndexedQuadStorage->>SearchIndexHandler: patch([{insertions, deletions}])
    
    alt insertions
        SearchIndexHandler->>EmbeddingsService: embed(text)
        EmbeddingsService-->>SearchIndexHandler: vector[]
        SearchIndexHandler->>ChunkIndex: setChunk(record)
    end
    
    alt deletions
        SearchIndexHandler->>ChunkIndex: deleteChunk(quadId)
    end
    
    SearchIndexHandler->>ChunkIndexManager: setIndexState(state)
    ChunkIndexManager-->>Worlds: done
    Worlds-->>Client: null (UPDATE result)
```

## Data Flow - Search Query

```mermaid
sequenceDiagram
    participant Client
    participant Worlds
    participant QuadStorageManager
    participant ChunkIndexManager
    participant ChunkIndex
    
    Client->>Worlds: search(query, sources)
    Worlds->>QuadStorageManager: getQuadStorage(refs)
    
    loop for each world
        alt world indexed
            Worlds->>ChunkIndexManager: getChunkIndex(ref)
            ChunkIndexManager-->>Worlds: ChunkIndex
            Worlds->>ChunkIndex: search(query)
            ChunkIndex-->>Worlds: ChunkSearchRow[]
        else world not indexed
            QuadStorageManager->>QuadStorageManager: findQuads([]) - full scan
            QuadStorageManager-->>QuadStorageManager: score by term matches
        end
    end
    
    QuadStorageManager-->>Worlds: results (ranked)
    Worlds-->>Client: SearchResult[]
```

## Implementation Hierarchy

```mermaid
classDiagram
    class QuadStorageConfig {
        +embeddings?: EmbeddingsService
        +chunks?: ChunkIndexManager
    }
    
    class InMemoryQuadStorage {
        -Map~string, StoredQuad~ quads
        +setQuad(quad: StoredQuad) Promise~void~
        +deleteQuad(quad: StoredQuad) Promise~void~
        +setQuads(quads: StoredQuad[]) Promise~void~
        +deleteQuads(quads: StoredQuad[]) Promise~void~
        +findQuads(matchers: StoredQuad[]) Promise~StoredQuad[]~
        +clear() Promise~void~
    }
    
    class IndexedQuadStorage {
        -QuadStorage inner
        -PatchHandler[] handlers
        +setQuad(quad: StoredQuad) Promise~void~
        +deleteQuad(quad: StoredQuad) Promise~void~
        +setQuads(quads: StoredQuad[]) Promise~void~
        +deleteQuads(quads: StoredQuad[]) Promise~void~
        +findQuads(matchers: StoredQuad[]) Promise~StoredQuad[]~
        +clear() Promise~void~
    }
    
    class InMemoryQuadStorageManager {
        -Map~string, InMemoryQuadStorage~ storage
        +getQuadStorage(ref) Promise~InMemoryQuadStorage~
        +deleteQuadStorage(ref) Promise~void~
    }
    
    class IndexedQuadStorageManager {
        -Map~string, IndexedQuadStorage~ storage
        -EmbeddingsService embeddings
        -ChunkIndexManager chunks
        +getQuadStorage(ref) Promise~IndexedQuadStorage~
        +deleteQuadStorage(ref) Promise~void~
    }
    
    class InMemoryChunkIndexManager {
        -Map~string, InMemoryChunkIndex~ indexesByWorld
        -Map~string, ChunkIndexState~ indexStateByWorld
        +getChunkIndex(ref) Promise~ChunkIndex~
        +getIndexState(world) Promise~ChunkIndexState~
        +setIndexState(state) Promise~void~
        +deleteChunkIndex(ref) Promise~void~
    }
    
    class OramaChunkIndexManager {
        -Map~string, ChunkOrama~ oramas
        -Map~string, OramaChunkIndex~ indexes
        -Map~string, ChunkIndexState~ indexStateByWorld
        +getChunkIndex(ref) Promise~ChunkIndex~
        +getIndexState(world) Promise~ChunkIndexState~
        +setIndexState(state) Promise~void~
        +deleteChunkIndex(ref) Promise~void~
    }
    
    class NoopEmbeddingsService {
        +dimensions: number
        +embed(text: string) Promise~number[]~
    }
    
    class Worlds {
        -WorldStorage worldStorage
        -QuadStorageManager quadStorageManager
        +createWorld(ref) Promise~StoredWorld~
        +getWorld(ref) Promise~StoredWorld~
        +updateWorld(ref, world) Promise~void~
        +deleteWorld(ref) Promise~void~
        +query(sparql, sources) Promise~QueryResult~
        +search(query, sources) Promise~SearchResult[]~
    }
    
    QuadStorage <|-- InMemoryQuadStorage: implements
    QuadStorage <|-- IndexedQuadStorage: implements
    IndexedQuadStorage --> InMemoryQuadStorage: wraps
    IndexedQuadStorage --> SearchIndexHandler: notifies
    
    QuadStorageManager <|-- InMemoryQuadStorageManager: implements
    QuadStorageManager <|-- IndexedQuadStorageManager: implements
    InMemoryQuadStorageManager --> InMemoryQuadStorage: creates
    IndexedQuadStorageManager --> IndexedQuadStorage: creates
    IndexedQuadStorageManager --> EmbeddingsService: uses
    IndexedQuadStorageManager --> ChunkIndexManager: uses
    
    ChunkIndexManager <|-- InMemoryChunkIndexManager: implements
    ChunkIndexManager <|-- OramaChunkIndexManager: implements
    EmbeddingsService <|-- NoopEmbeddingsService: implements
```

## Storage Layers

```mermaid
flowchart TB
    subgraph Worlds
        A[Worlds] --> B[WorldStorage]
        A --> C[QuadStorageManager]
    end
    
    subgraph Storage Managers
        C --> D[IndexedQuadStorageManager]
        C --> E[InMemoryQuadStorageManager]
    end
    
    subgraph Quad Layer
        D --> F[IndexedQuadStorage]
        E --> G[InMemoryQuadStorage]
        F --> H[SearchIndexHandler]
        H --> I[EmbeddingsService]
        H --> J[ChunkIndex]
    end
    
    subgraph Index Layer
        I --> K[NoopEmbeddingsService]
        J --> L[InMemoryChunkIndex]
        J --> M[OramaChunkIndex]
    end
    
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#bbf,stroke:#333
    style C fill:#bbf,stroke:#333
    style D fill:#bfb,stroke:#333
    style E fill:#bfb,stroke:#333
    style F fill:#dfd,stroke:#333
    style G fill:#dfd,stroke:#333
    style H fill:#dfd,stroke:#333
    style I fill:#fdd,stroke:#333
    style J fill:#fdd,stroke:#333
    style K fill:#efe,stroke:#333
    style L fill:#efe,stroke:#333
    style M fill:#efe,stroke:#333
```

## Key Types

### QuadStorageConfig

```typescript
interface QuadStorageConfig {
  embeddings?: EmbeddingsService | null;
  chunks?: ChunkIndexManager | null;
}
```

### StoredQuad

```typescript
interface StoredQuad {
  subject: string; // RDF subject (IRI or blank node)
  predicate: string; // RDF predicate (IRI)
  object: string; // RDF object (literal, IRI, or blank node)
  graph: string; // Named graph identifier
  objectTermType?: "NamedNode" | "BlankNode" | "Literal";
  objectDatatype?: string; // XSD datatype for literals
  objectLanguage?: string; // Language tag for language-tagged literals
}
```

### ChunkRecord

```typescript
interface ChunkRecord {
  id: string; // SHA-256 hash of quadId:chunk:index
  quadId: string; // Skolemized quad identifier
  subject: string; // From source quad
  predicate: string; // From source quad
  text: string; // Extracted/chunked text
  vector: Float32Array; // Embedding vector
  world: WorldReference;
}
```

## Directory Layout

The `src/worlds` package is organized to clearly separate application logic
(like `Worlds` and `SPARQL` orchestration) from data storage interfaces and
implementations:

```text
src/
├── api/                   # Presentation Layer (RPC handlers, OpenAPI)
├── core/                  # Application Layer (Orchestration, Worlds API)
│   ├── storage/           # Core metadata storage
│   ├── worlds.ts          # Main implementation
│   └── interfaces.ts      # Core interfaces
├── rdf/                   # RDF substrate (RDFJS conversion, SPARQL, quad storage)
│   ├── rdf/               # Serialization and parsing
│   ├── sparql/            # Query execution
│   └── storage/           # Quad persistence (writes can be wrapped to emit indexing patches)
└── indexing/              # Indexing subsystem (embeddings, chunk indexes, FTS helpers)
    ├── embeddings/        # Embedding providers
    ├── handlers/          # Index-on-write handlers (RDF writes -> chunk index)
    └── storage/           # Chunk index implementations
```

## Usage Examples

### Setting up with InMemoryQuadStorageManager

If you want a lightweight, in-memory implementation without search indexing
(SPARQL-only):

```typescript
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryQuadStorageManager } from "#/rdf/storage/in-memory-quad-storage-manager.ts";

const worlds = new Worlds(
  new InMemoryWorldStorage(),
  new InMemoryQuadStorageManager(),
);

await worlds.createWorld({ namespace: "demo", id: "w1", displayName: "Demo" });
```

### Setting up with IndexedQuadStorageManager

If you need vector search and chunking, use `IndexedQuadStorageManager`:

```typescript
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { IndexedQuadStorageManager } from "#/rdf/storage/indexed-quad-storage-manager.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { OpenAIEmbeddingsService } from "#/indexing/embeddings/openai.ts";

const chunkIndexManager = new InMemoryChunkIndexManager();
const embeddings = new OpenAIEmbeddingsService({ apiKey: "sk-..." });

const worlds = new Worlds(
  new InMemoryWorldStorage(),
  new IndexedQuadStorageManager(embeddings, chunkIndexManager),
  { chunkIndexManager, embeddings }, // Provide search deps for global querying
);
```
