# Deno RPC demo

This demo runs an RPC server and uses a client script to call `POST /rpc`.

## Run the server

```bash
deno run -A sandbox/deno/rpc/main.ts
```

The server prints the `X-Api-Key` to use. Copy and use it in the command below

## Run the client

```bash
WORLDS_API_KEY=... deno run -A sandbox/deno/rpc/client.ts
```

Optional overrides:

- `WORLDS_RPC_URL` (default: `http://localhost:8001/rpc`)
- `PORT` for the server (default: `8001`)

## What it does

- Creates a world
- Imports a few N-Quads
- Runs a SPARQL `SELECT`
- Searches the indexed literals
- Exports the world back to N-Quads
- Lists available worlds
