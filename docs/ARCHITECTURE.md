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
    
    class WorldFactStorage {
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
    
    WorldReference --> WorldFactStorage
    WorldReference --> WorldStorage
    WorldReference --> ChunkStorage
    
    FactStorage --> WorldFactStorage: managed by
    ChunkStorage --> WorldFactStorage: indexed by
    EmbeddingsService --> WorldFactStorage: vectorized by
    PatchHandler --> FactStorage: wraps
    
    WorldFactStorage "1" *-- "many" FactStorage: creates
```

## Data Flow - Search Index Pipeline

```mermaid
sequenceDiagram
    participant Client
    participant WorldsCore
    participant WorldFactStorage
    participant IndexedFactStorage
    participant SearchIndexHandler
    participant EmbeddingsService
    participant ChunkStorage
    
    Client->>WorldsCore: sparql UPDATE (INSERT/DELETE)
    WorldsCore->>WorldFactStorage: getFactStorage(ref)
    WorldFactStorage-->>IndexedFactStorage: returns
    
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
    ChunkStorage-->>WorldsCore: done
    WorldsCore-->>Client: null (UPDATE result)
```

## Data Flow - Search Query

```mermaid
sequenceDiagram
    participant Client
    participant WorldsCore
    participant WorldFactStorage
    participant ChunkStorage
    
    Client->>WorldsCore: search(query, sources)
    WorldsCore->>WorldFactStorage: getFactStorage(refs)
    
    loop for each world
        alt world indexed
            WorldFactStorage->>ChunkStorage: search(query, topK)
            ChunkStorage-->>WorldFactStorage: ChunkSearchRow[]
        else world not indexed
            WorldFactStorage->>WorldFactStorage: findFacts([]) - full scan
            WorldFactStorage-->>WorldFactStorage: score by term matches
        end
    end
    
    WorldFactStorage-->>WorldsCore: results (ranked)
    WorldsCore-->>Client: SearchResult[]
```

## Implementation Hierarchy

```mermaid
classDiagram
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
    
    class IndexedWorldFactStorage {
        -Map~string, IndexedFactStorage~ wrapped
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
    
    class PlaceholderEmbeddingsService {
        +dimensions: number
        +embed(text: string) Promise~number[]~
    }
    
    FactStorage <|-- InMemoryFactStorage: implements
    FactStorage <|-- IndexedFactStorage: implements
    IndexedFactStorage --> InMemoryFactStorage: wraps
    IndexedFactStorage --> SearchIndexHandler: notifies
    WorldFactStorage <|-- IndexedWorldFactStorage: implements
    IndexedWorldFactStorage --> IndexedFactStorage: creates
    IndexedWorldFactStorage --> EmbeddingsService: uses
    IndexedWorldFactStorage --> ChunkStorage: uses
    ChunkStorage <|-- InMemoryChunkStorage: implements
    EmbeddingsService <|-- PlaceholderEmbeddingsService: implements
```

## Storage Layers

```mermaid
flowchart TB
    subgraph WorldsCore
        A[WorldsCore] --> B[WorldStorage]
        A --> C[WorldFactStorage]
    end
    
    subgraph Fact Layer
        C --> D[IndexedFactStorage]
        D --> E[InMemoryFactStorage]
        D --> F[SearchIndexHandler]
        F --> G[EmbeddingsService]
        F --> H[ChunkStorage]
    end
    
    subgraph Index Layer
        G --> I[PlaceholderEmbeddingsService]
        H --> J[InMemoryChunkStorage]
    end
    
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#bbf,stroke:#333
    style C fill:#bbf,stroke:#333
    style D fill:#bfb,stroke:#333
    style E fill:#dfd,stroke:#333
    style F fill:#dfd,stroke:#333
    style G fill:#fdd,stroke:#333
    style H fill:#fdd,stroke:#333
    style I fill:#efe,stroke:#333
    style J fill:#efe,stroke:#333
```

## Key Types

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
