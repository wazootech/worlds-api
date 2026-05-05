# Deno core demo

This demo uses the `Worlds` class directly (without HTTP) to showcase the core
API.

## Run

```bash
deno run -A sandbox/deno/core/main.ts
```

## What it does

- Creates a world
- Imports a few N-Quads
- Runs a SPARQL `SELECT`
- Searches the indexed literals
- Exports the world back to N-Quads
- Lists available worlds
