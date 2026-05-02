# worlds-api

Worlds Platform is a context layer for agents. The engine manages, queries, and
proves knowledge using SPARQL standards at the edge.

API request/response shapes live in **OpenAPI** under `src/api/openapi/`;
explore the public surface with `deno doc src/mod.ts`.

## Development

This repo uses Deno and npm dependencies (via Deno's npm compatibility layer).

Note: this repo uses Deno `links` to override a transitive npm dependency (see
`vendor/jsonld-context-parser`). We do this as a workaround for Deno npm/CJS
compatibility issues in Comunica's JSON-LD dependency tree (outside of this
repo's control). Using `links` requires a `node_modules` directory, so
`deno.json` keeps `"nodeModulesDir": "auto"`. If you remove it, Deno will error
with: `Linking npm packages requires using a node_modules directory...`.

### Install dependencies

Deno will download dependencies automatically when you run tasks, but you can
prefetch/cache everything up front:

```bash
deno install
```

### Run the API in watch mode

```bash
deno task dev
```

### Run tests

```bash
deno task test
```

### Pre-commit checks

Before pushing, run locally to match CI:

```bash
deno test --allow-all
deno fmt --check
deno lint
```

### Browser guard rails

- `deno task check:browser`: type-check the browser entrypoints against DOM libs
- `deno task bundle:browser`: bundles the browser entrypoints (smoke test)
