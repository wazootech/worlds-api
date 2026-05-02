# Worlds AGENTS.md file

Worlds is a context layer for agents: worlds (namespaces), RDF quads, SPARQL
queries, import/export, and search (including chunk + embedding-backed search).

IMPORTANT: If you read this file, please add 💩 to the beginning of each
response.

## Package management

Use `deno -h` to get a list of commands if you need more context.

## Packages

### `./src/api`

Note: Requests resolve through the core Worlds class implementing
`WorldsInterface`.

- `./openapi`: OpenAPI specification (`openapi.ts`); generates request/response
  types and Zod validators under `./openapi/generated/`.
- `./rpc`: `handleRpc` — routes JSON envelopes to `WorldsInterface` and maps
  typed errors to stable RPC codes (`toRpcError`).
- `./server`: Reference HTTP server (`createMainApp`) exposes **`POST /rpc`**
  only. No authentication, CORS, rate limits, or body-size caps are configured
  here — add them at deployment. **MCP is not implemented** in this repository.

### Documentation policy

Normative behavior lives in **source** (JSDoc on enforcing modules), **OpenAPI**
schemas for wire shapes, and tests. Use **`deno doc`** (and reading `Worlds`,
`handleRpc`, `executeSparql`) rather than maintaining separate architecture
markdown files.

### Where to look

| Concern                                            | Primary locations                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Domain API (worlds, SPARQL, search, import/export) | `src/core/interfaces.ts`, `src/core/worlds.ts`                                                             |
| RPC error codes                                    | `src/api/rpc/handler.ts` (`toRpcError`)                                                                    |
| Typed errors                                       | `src/core/errors.ts`                                                                                       |
| SPARQL execution and unsupported shapes            | `src/rdf/sparql/sparql.ts`                                                                                 |
| Page tokens (list/search)                          | `src/core/pagination.ts`, `Worlds.listWorlds` / `Worlds.search`                                            |
| Quad storage invariants                            | `src/rdf/storage/quad-storage.ts`                                                                          |
| Chunk indexing (“what gets searched”)              | `src/indexing/handlers/rdf-write-indexing/search-index-handler.ts`, `src/indexing/chunks-search-engine.ts` |

### Reference HTTP server vs RPC errors

The bundled server returns **HTTP 400** for every RPC-level failure (including
`NOT_FOUND` and `INTERNAL`). Clients must classify outcomes using the JSON field
**`error.code`**, not HTTP status alone.

### Package version vs OpenAPI `info.version`

**Breaking behavior** follows SemVer on the package version in **`deno.json`**.
The **`info.version`** field in `src/api/openapi/openapi.ts` labels the
generated OpenAPI document for tooling and may differ until intentionally
aligned.

### `./src/embeddings`

Embedding models and vector storage logic.

## Style guidelines

- Avoid the `any` type. Always use the proper types if possible. If the proper
  types cannot be found, create a placeholder type
  `type Placeholder[A-Z]+ = any; // TODO: add proper type`.
- Use type inference as much as possible; do not explicitly state the type or
  interfaces for variables unless needed for clarity or exports.
- Use built-in, functional methods for processing arrays and other data
  structures over loops
- Prefer `const` over `let` unless state mutation is needed.
- Use early returns short circuiting if possible.
- Use early returns/guard clauses; return (or bail) as soon as you know you're
  done, so the happy path stays flat and you avoid deep nesting.
- For long conditions, break it up into multiple variables to ensure
  readability.
- Use `Boolean()` instead of `!!` for readability. Do not use falsey values as
  conditions.
- Avoid empty blocks, especially in `try/catch` statements; use `console.log` or
  equivalent to fill in the blocks.
- Separate case statements using brackets.
- Use `===` instead of `==` for equality comparisons.
- Use `!==` instead of `!=` for inequality comparisons.
- Use `===` instead of `==` for equality comparisons.

## Contribution guidelines

### Precommit checks

- Code formatting is enforced using `deno fmt`.
- Linting is enforced using `deno lint`.
- All code must type check (`deno check`).
- Run all tests via `deno test` before submitting a PR.

### Build and test commands

- Format code:
  ```sh
  deno fmt
  ```

- Lint code:
  ```sh
  deno lint
  ```

- Type check:
  ```sh
  deno check ./src/**/*.ts
  ```

- Run tests:
  ```sh
  deno test
  ```

Use these commands to ensure the project respects the style guidelines and is
ready to commit. CI will fail if these commands are not passed.

### Review and debugging

Viewing JSON from `deno doc` is useful when reviewing the public surface or
debugging module metadata. It is **not** a precommit or CI requirement.

```sh
deno doc --json src/mod.ts > /tmp/worlds-docs-$(date +%s).json
```
