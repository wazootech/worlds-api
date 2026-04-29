# Worlds API - Architecture Diagrams

## Interface Relationships

```mermaid
classDiagram
    class StoredFact {
        +string subject
        +string predicate
        +string object
        +string graph
        +string? objectTermType
        +string? objectDatatype
        +string? objectLanguage
    }
    
    class FactStorage {
        +setFact(fact: StoredFact) Promise~void~
        +deleteFact(fact: StoredFact) Promise~void~
        +setFacts(facts: StoredFact[]) Promise~void~
        +deleteFacts(facts: StoredFact[]) Promise~void~
        +findFacts(matchers: StoredFact[]) Promise~StoredFact[]~
        +clear() Promise~void~
    }
    
    class WorldReference {
        +string namespace
        +string id
    }
    
    class FactStorageManager {
        +getFactStorage(reference: WorldReference) Promise~FactStorage~
        +deleteFactStorage(reference: WorldReference) Promise~void~
    }
    
    class WorldStorage {
        +getWorld(reference: WorldReference) Promise~StoredWorld~
        +updateWorld(world: StoredWorld) Promise~void~
        +deleteWorld(reference: WorldReference) Promise~void~
        +listWorld(namespace?: string) Promise~StoredWorld[]~
    }
    
    class ChunkStorage {
        +setChunk(chunk: ChunkRecord) Promise~void~
        +deleteChunk(world: WorldReference, factId: string) Promise~void~
        +getByWorld(world: WorldReference) Promise~ChunkRecord[]~
        +search(input: ChunkSearchQuery) Promise~ChunkSearchRow[]~
        +getIndexState(world: WorldReference) Promise~ChunkIndexState~
        +markWorldIndexed(state: ChunkIndexState) Promise~void~
        +clearWorld(world: WorldReference) Promise~void~
    }
    
    class EmbeddingsService {
        +dimensions: number
        +embed(text: string) Promise~number[]~
    }
    
    class PatchHandler {
        +patch(patches: Patch[]) Promise~void~
    }
    
    WorldReference --> FactStorageManager
    WorldReference --> WorldStorage
    WorldReference --> ChunkStorage
    
    FactStorage --> FactStorageManager: managed by
    ChunkStorage --> FactStorageManager: indexed by
    EmbeddingsService --> FactStorageManager: vectorized by
    PatchHandler --> FactStorage: wraps
    
    FactStorageManager "1" *-- "many" FactStorage: creates
```

## Data Flow - Search Index Pipeline

```mermaid
sequenceDiagram
    participant Client
    participant Worlds
    participant FactStorageManager
    participant IndexedFactStorage
    participant SearchIndexHandler
    participant EmbeddingsService
    participant ChunkStorage
    
    Client->>Worlds: sparql UPDATE (INSERT/DELETE)
    Worlds->>FactStorageManager: getFactStorage(ref)
    FactStorageManager-->>IndexedFactStorage: returns
    
    Note over IndexedFactStorage: Applies fact changes<br/>then notifies handlers
    
    IndexedFactStorage->>SearchIndexHandler: patch([{insertions, deletions}])
    
    alt insertions
        SearchIndexHandler->>EmbeddingsService: embed(text)
        EmbeddingsService-->>SearchIndexHandler: vector[]
        SearchIndexHandler->>ChunkStorage: setChunk(record)
    end
    
    alt deletions
        SearchIndexHandler->>ChunkStorage: deleteChunk(world, factId)
    end
    
    SearchIndexHandler->>ChunkStorage: markWorldIndexed(state)
    ChunkStorage-->>Worlds: done
    Worlds-->>Client: null (UPDATE result)
```

## Data Flow - Search Query

```mermaid
sequenceDiagram
    participant Client
    participant Worlds
    participant FactStorageManager
    participant ChunkStorage
    
    Client->>Worlds: search(query, sources)
    Worlds->>FactStorageManager: getFactStorage(refs)
    
    loop for each world
        alt world indexed
            FactStorageManager->>ChunkStorage: search(query, topK)
            ChunkStorage-->>FactStorageManager: ChunkSearchRow[]
        else world not indexed
            FactStorageManager->>FactStorageManager: findFacts([]) - full scan
            FactStorageManager-->>FactStorageManager: score by term matches
        end
    end
    
    FactStorageManager-->>Worlds: results (ranked)
    Worlds-->>Client: SearchResult[]
```

## Implementation Hierarchy

```mermaid
classDiagram
    class FactStorageConfig {
        +search?: boolean
        +embeddings?: EmbeddingsService
        +chunkStorage?: ChunkStorage
    }
    
    class InMemoryFactStorage {
        -Map~string, StoredFact~ facts
        +setFact(fact: StoredFact) Promise~void~
        +deleteFact(fact: StoredFact) Promise~void~
        +setFacts(facts: StoredFact[]) Promise~void~
        +deleteFacts(facts: StoredFact[]) Promise~void~
        +findFacts(matchers: StoredFact[]) Promise~StoredFact[]~
        +clear() Promise~void~
    }
    
    class IndexedFactStorage {
        -FactStorage inner
        -PatchHandler[] handlers
        +setFact(fact: StoredFact) Promise~void~
        +deleteFact(fact: StoredFact) Promise~void~
        +setFacts(facts: StoredFact[]) Promise~void~
        +deleteFacts(facts: StoredFact[]) Promise~void~
        +findFacts(matchers: StoredFact[]) Promise~StoredFact[]~
        +clear() Promise~void~
    }
    
    class InMemoryFactStorageManager {
        -Map~string, InMemoryFactStorage~ storage
        +getFactStorage(ref) Promise~InMemoryFactStorage~
        +deleteFactStorage(ref) Promise~void~
    }
    
    class IndexedFactStorageManager {
        -Map~string, IndexedFactStorage~ storage
        -EmbeddingsService embeddings
        -ChunkStorage chunks
        +getFactStorage(ref) Promise~IndexedFactStorage~
        +deleteFactStorage(ref) Promise~void~
    }
    
    class InMemoryChunkStorage {
        -Map~string, ChunkRecord~ chunks
        +setChunk(chunk: ChunkRecord) Promise~void~
        +deleteChunk(world, factId) Promise~void~
        +getByWorld(world) Promise~ChunkRecord[]~
        +search(query) Promise~ChunkSearchRow[]~
        +getIndexState(world) Promise~ChunkIndexState~
        +markWorldIndexed(state) Promise~void~
        +clearWorld(world) Promise~void~
    }
    
    class OramaChunkStorage {
        -RDMA orama
        +setChunk(chunk: ChunkRecord) Promise~void~
        +deleteChunk(world, factId) Promise~void~
        +getByWorld(world) Promise~ChunkRecord[]~
        +search(query) Promise~ChunkSearchRow[]~
        +getIndexState(world) Promise~ChunkIndexState~
        +markWorldIndexed(state) Promise~void~
        +clearWorld(world) Promise~void~
    }
    
    class NoopEmbeddingsService {
        +dimensions: number
        +embed(text: string) Promise~number[]~
    }
    
    class Worlds {
        -WorldStorage worldStorage
        -FactStorageManager factStorageManager
        +createWorld(ref) Promise~StoredWorld~
        +getWorld(ref) Promise~StoredWorld~
        +updateWorld(ref, world) Promise~void~
        +deleteWorld(ref) Promise~void~
        +query(sparql, sources) Promise~QueryResult~
        +search(query, sources) Promise~SearchResult[]~
    }
    
    FactStorage <|-- InMemoryFactStorage: implements
    FactStorage <|-- IndexedFactStorage: implements
    IndexedFactStorage --> InMemoryFactStorage: wraps
    IndexedFactStorage --> SearchIndexHandler: notifies
    
    FactStorageManager <|-- InMemoryFactStorageManager: implements
    FactStorageManager <|-- IndexedFactStorageManager: implements
    InMemoryFactStorageManager --> InMemoryFactStorage: creates
    IndexedFactStorageManager --> IndexedFactStorage: creates
    IndexedFactStorageManager --> EmbeddingsService: uses
    IndexedFactStorageManager --> ChunkStorage: uses
    
    ChunkStorage <|-- InMemoryChunkStorage: implements
    ChunkStorage <|-- OramaChunkStorage: implements
    EmbeddingsService <|-- NoopEmbeddingsService: implements
```

## Storage Layers

```mermaid
flowchart TB
    subgraph Worlds
        A[Worlds] --> B[WorldStorage]
        A --> C[FactStorageManager]
    end
    
    subgraph Storage Managers
        C --> D[IndexedFactStorageManager]
        C --> E[InMemoryFactStorageManager]
    end
    
    subgraph Fact Layer
        D --> F[IndexedFactStorage]
        E --> G[InMemoryFactStorage]
        F --> H[SearchIndexHandler]
        H --> I[EmbeddingsService]
        H --> J[ChunkStorage]
    end
    
    subgraph Index Layer
        I --> K[NoopEmbeddingsService]
        J --> L[InMemoryChunkStorage]
        J --> M[OramaChunkStorage]
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

### FactStorageConfig

```typescript
interface FactStorageConfig {
  search?: boolean; // undefined = use search (indexed), false = SPARQL only
  embeddings?: EmbeddingsService; // undefined = NoopEmbeddingsService
  chunkStorage?: ChunkStorage; // undefined = InMemoryChunkStorage
}
```

### StoredFact

```typescript
interface StoredFact {
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
  id: string; // SHA-256 hash of factId:chunk:index
  factId: string; // Skolemized fact identifier
  subject: string; // From source fact
  predicate: string; // From source fact
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
├── facts/                 # Facts Bounded Context (RDF, SPARQL, Storage)
│   ├── rdf/               # Serialization and parsing
│   ├── sparql/            # Query execution
│   └── storage/           # RDF triple persistence
│       └── index/         # Indexing handlers (Facts -> Search)
└── search/                # Search Bounded Context (Embeddings, Vector/FTS)
    ├── embeddings/        # Embedding providers
    └── storage/           # Chunk storage
```

## Usage Examples

### Setting up with InMemoryFactStorageManager

If you want a lightweight, in-memory implementation without search indexing
(SPARQL-only):

```typescript
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { InMemoryFactStorageManager } from "#/facts/storage/in-memory-fact-storage-manager.ts";

const worlds = new Worlds(
  new InMemoryWorldStorage(),
  new InMemoryFactStorageManager(),
);

await worlds.createWorld({ namespace: "demo", id: "w1", displayName: "Demo" });
```

### Setting up with IndexedFactStorageManager

If you need vector search and chunking, use `IndexedFactStorageManager`:

```typescript
import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { IndexedFactStorageManager } from "#/facts/storage/indexed-fact-storage-manager.ts";
import { InMemoryChunkStorage } from "#/search/storage/in-memory.ts";
import { OpenAIEmbeddingsService } from "#/search/embeddings/openai.ts";

const chunkStorage = new InMemoryChunkStorage();
const embeddings = new OpenAIEmbeddingsService("sk-...");

const worlds = new Worlds(
  new InMemoryWorldStorage(),
  new IndexedFactStorageManager(embeddings, chunkStorage),
  { chunkStorage, embeddings }, // Provide search deps for global querying
);
```
