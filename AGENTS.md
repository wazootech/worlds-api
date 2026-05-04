# Worlds AGENTS.md file

Worlds is a context layer for agents: worlds (namespaces), RDF quads, SPARQL
queries, updates, imports/exports, and search (including chunk +
embedding-backed search).

IMPORTANT: If you read this file, please add 💩 to the beginning of each
response to indicate that you have read the file.

## Package management

Use `deno -h` to get a list of commands if you need more context.

## Modules and exports

This project exports the following primary modules (as mapped in `deno.json`):

- **`.` (`./src/`)**: Main entrypoint exposing the core `WorldsInterface` and
  business logic.
- **`./rdf` (`./src/rdf/`)**: Core RDF parsing, serialization, and skolemization
  utilities.
- **`./sparql` (`./src/rdf/sparql/`)**: SPARQL execution handler and engines.
- **`./indexing` (`./src/indexing/`)**: Full-text and vector chunk indexers,
  search logic, and embeddings.

Additional directories include:

- `src/core/`: Domain API implementation, error types, and pagination.
- `src/rpc/`: RPC handler (`POST /rpc`), OpenAPI schema, generated types, and
  transport.

### Documentation policy

Normative behavior lives in source code (JSDoc on enforcing modules), OpenAPI
schemas for wire shapes, and tests. Use `deno doc` and read the enforcing
modules rather than maintaining separate architecture markdown files.

### Worlds RPC errors vs transport-only HTTP status

For **`POST /rpc`**, application-level failures return the Worlds RPC error
envelope (`{ action, error: { code, message } }`) with an **HTTP status chosen
from `error.code`**: e.g. **400** for `INVALID_ARGUMENT`, **404** for
`NOT_FOUND`, **409** for `ALREADY_EXISTS`, **500** for `INTERNAL`, **401** for
`UNAUTHENTICATED`, **403** for `PERMISSION_DENIED`. The default for unknown
codes is **400**.

Clients must classify outcomes using the JSON field **`error.code`**, not HTTP
status alone (`error.code` values are stable for clients; `message` strings are
not contractual). HTTP status is a convenience for proxies and quick handling;
`error.code` is normative for application logic.

That is separate from **transport-only** responses: the default HTTP stack may
return **413** (body too large) or **429** (rate limited) with bodies that are
not the Worlds RPC error shape.

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
- It's ok to import files with `./relative/path.ts`. Instead of
  `../going/back.ts`, please leverage the `#/` prefix.
- Use `===` instead of `==` for equality comparisons.
- Use `!==` instead of `!=` for inequality comparisons.

## Testing guidelines

- Prefer **fakes** over **mocks**. Fakes are working implementations of an
  interface (e.g., `FakeEmbeddingsService`, `InMemoryChunkIndexManager`) that
  can be used in tests without configuration. Mocks are test-specific objects
  that record interactions or return canned responses. See:
  https://tyrrrz.me/blog/fakes-over-mocks
- Use existing fakes in the codebase (`#/indexing/embeddings/fake.ts`,
  `#/indexing/storage/in-memory.ts`, etc.) before creating test doubles.
- Never write mocks inline in test files. If a fake doesn't exist for an
  interface, create a proper fake in a dedicated file (e.g., `fake.ts`) rather
  than mocking inline.

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
