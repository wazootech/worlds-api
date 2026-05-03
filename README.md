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

Uses [`deno serve`](https://docs.deno.com/runtime/reference/cli/serve/)
(`main.ts` default-exports `fetch`). Default port is **8000**; use
`deno serve --port=3000 main.ts` to override.

```bash
deno task dev
```

### Production and deployment

The default root `main.ts` default-exports `fetch` for **`deno serve`** and
serves `mainApp` with **in-memory** storage (data does not survive restart). For
**Turso / libSQL-backed** persistence, environment variables (`LIBSQL_URL`,
`LIBSQL_AUTH_TOKEN`), and why the stack standardizes on **`@libsql/client`**,
see the HTTP server module docs:

```bash
deno doc src/api/server/main.ts
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

### Browser bundles (optional)

- `deno task bundle:browser`: bundle the browser entrypoints (smoke test;
  `--no-check`)

Type-checking uses the default Deno config (`deno check ./src/**/*.ts`), not DOM
`lib` targets. If you need strict browser-lib checking again, add a dedicated
config or use `deno check` with inline `--config` / compiler options.
