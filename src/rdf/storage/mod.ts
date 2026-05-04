// Re-export types and interfaces
export type { StoredQuad } from "./types.ts";
export type { QuadStorage, QuadStorageConfig, QuadStorageManager } from "./interface.ts";
export { storedQuadKey } from "./quad-key.ts";

// Re-export implementations
export { InMemoryQuadStorage } from "./in-memory/storage.ts";
export { InMemoryQuadStorageManager } from "./in-memory/manager.ts";
export { IndexedQuadStorage } from "./indexed/storage.ts";
export { IndexedQuadStorageManager, type IndexedQuadStorageManagerConfig } from "./indexed/manager.ts";
export { LibsqlQuadStorage } from "./libsql/storage.ts";
export { LibsqlQuadStorageManager } from "./libsql/manager.ts";

// Re-export contract tests
export { testQuadStorageManager } from "./testing.ts";
