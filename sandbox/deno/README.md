# Deno sandbox demos

Two simple demos for the Worlds library:

- `sandbox/deno/core`: no HTTP reqs being made, it imports from `core/` in main
  `src` folder
- `sandbox/deno/rpc`: RPC server + client script

```bash
# core
deno run -A sandbox/deno/core/main.ts

# rpc
deno run -A sandbox/deno/rpc/main.ts # output shows the api key needed for the client to make requests to the RPC server
WORLDS_API_KEY=... deno run -A sandbox/deno/rpc/client.ts
```
