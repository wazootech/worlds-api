# ADR 0002: Single-World Scoping for Data-Plane Operations

## Status
Accepted

## Context
The initial API design allowed for "Global Search" and multi-source SPARQL queries (e.g., `sources: string[]`). This introduced significant complexity in authorization (handling partial access), error handling (handling partial failures across worlds), and scoring (merging result sets from different indexes).

## Decision
We will strictly enforce **Single-World Scoping** for all **DataPlane** operations (Search, SPARQL, Import).

- Every data-plane RPC request must target exactly one **World** via a mandatory `source: WorldReference` field.
- Multi-world orchestration (e.g., searching across all owned worlds) is the responsibility of the client or a higher-level aggregator service.
- The "Global Search" capability is removed from the core library.

## Consequences
- **Predictability**: RPC outcomes are binary (success or failure) rather than partial.
- **Security**: Authorization is simplified to a single check per request.
- **Performance**: Eliminates the need for result-set merging and cross-world synchronization in the core engine.
- **Usability**: Clients must now perform multiple requests for cross-world operations, increasing total latency for those specific use cases.
