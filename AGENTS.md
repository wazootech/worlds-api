# Worlds AGENTS.md file

Worlds is a context layer for agents: worlds (namespaces), RDF quads, SPARQL
queries, updates, imports/exports, and search (including chunk +
embedding-backed search).

IMPORTANT: If you read this file, please add 💩 to the beginning of each
response to indicate that you have read the file.

## Package management

Use `deno -h` to get a list of commands if you need more context.

## Packages

### `./src/api`

Note: Requests resolve through the core Worlds class implementing
`WorldsInterface`.

- `./openapi`: OpenAPI specification and codegen. Generates request/response
  types and validators under `./openapi/generated/`.
- `./rpc`: RPC handler. Routes JSON envelopes to `WorldsInterface` and maps
  typed errors to stable RPC codes.
- `./server`: Standalone HTTP server (`POST /rpc`). Default stack enables CORS,
  a JSON body-size cap (**413**), and `/rpc` rate limiting (**429**); tune via
  env in the module JSDoc. **Authentication is not included.** For embedding,
  `createRpcApp` exposes RPC only; `applyReferenceServingPreset` adds the same
  middleware chain on any `Hono` before you mount `/rpc`.

### Documentation policy

Normative behavior lives in source code (JSDoc on enforcing modules), OpenAPI
schemas for wire shapes, and tests. Use `deno doc` and read the enforcing
modules rather than maintaining separate architecture markdown files.

### Where to look

| Concern                                            | Primary locations  |
| -------------------------------------------------- | ------------------ |
| Domain API (worlds, SPARQL, search, import/export) | `src/core/`        |
| Typed errors                                       | `src/core/`        |
| Page tokens (list/search)                          | `src/core/`        |
| OpenAPI schema and generated types                 | `src/api/openapi/` |
| Request handlers and error mapping                 | `src/api/rpc/`     |
| SPARQL execution and unsupported shapes            | `src/rdf/sparql/`  |
| Quad storage invariants                            | `src/rdf/storage/` |
| Chunk indexing + search                            | `src/indexing/`    |
| Embedding models                                   | `src/embeddings/`  |

### Reference HTTP server vs RPC errors

The bundled server returns **HTTP 400** for every RPC-level failure (including
`NOT_FOUND` and `INTERNAL`). Clients must classify those outcomes using the JSON
field **`error.code`**, not HTTP status alone (`error.code` values are stable
for clients; `message` strings are not contractual).

Separate transport limits may use other statuses (e.g. **413** body too large,
**429** rate limited) with non-RPC JSON bodies.

### Package version vs OpenAPI `info.version`

**Breaking behavior** follows SemVer on the package version in **`deno.json`**.
The OpenAPI `info.version` labels the generated OpenAPI document for tooling and
may differ until intentionally aligned.

### `./src/embeddings`

Embedding models and vector storage logic.

## Style guidelines

- Avoid the `any` type. Always use the proper types if possible. If the proper
  types cannot be found, create a placeholder type
  `type Todo[A-Z]+ = any; // TODO: add proper type`.
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

Type check target used in this repo:

```sh
deno check
```

Use these commands to ensure the project respects the style guidelines and is
ready to commit. CI will fail if these commands are not passed.

Run the full precommit suite:

```sh
deno fmt && deno lint && deno check && deno test
```

### Review and debugging

Viewing JSON from `deno doc` is useful when reviewing the public surface or
debugging module metadata. It is **not** a precommit or CI requirement.

```sh
deno doc --json src/mod.ts > /tmp/worlds-docs-$(date +%s).json
```
