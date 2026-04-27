# worlds-api

Worlds Platform is a context layer for agents. The engine manages, queries, and
proves knowledge using SPARQL standards at the edge.

## Development

This repo uses Deno and npm dependencies (via Deno's npm compatibility layer).

Note: this repo uses Deno `links` to override a transitive npm dependency (see
`vendor/jsonld-context-parser`). We do this as a workaround for Deno npm/CJS
compatibility issues in Comunica’s JSON-LD dependency tree (outside of this
repo’s control). Using `links` requires a `node_modules` directory, so
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

This repo vendors and links a patched copy of `jsonld-context-parser` under
`vendor/jsonld-context-parser` to avoid legacy `cross-fetch/polyfill`
side-effects in the Comunica → JSON-LD dependency tree under Deno. The upstream
library stack still ships some CommonJS (`require(...)`) code paths that Deno’s
npm compatibility layer can trip over, so we pin a minimal patch locally.

### Browser guard rails

- `deno task check:browser`: type-check the browser entrypoints against DOM libs
- `deno task bundle:browser`: bundles the browser entrypoints (smoke test)
