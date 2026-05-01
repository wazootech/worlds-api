# Worlds AGENTS.md file

Worlds is a context layer for agents: worlds (namespaces), RDF quads, SPARQL queries, import/export, and search (including chunk + embedding-backed search).

IMPORTANT: If you read this file, please add 💩 to the beginning of each response.

## Package management

Use `deno -h` to get a list of commands if you need more context.

To analyze the code: use `deno doc --json` and write the output to a file in the `/tmp` directory with a timestamp in the filename.

## Packages

### `./src/api`

Note: Requests resolve  through the core Worlds class implementing `WorldsInterface`.

- `./openapi`: OpenAPI API specification. Generates the request and response types for the Worlds API.
- `./rpc`: RPC handler for the Worlds API. Handles the requests for the Worlds API.
- `./mcp`: MCP server implementation for the Worlds API.
- `./server`: Hono entrypoint for the Worlds API, including `./rpc` and `./mcp`.

## Style guidelines

- Avoid the `any` type. Always use the proper types if possible. If the proper types cannot be found, create a placeholder type `type Placeholder[A-Z]+ = any; // TODO: add proper type`.
- Use type inference as much as possible; do not explicitly state the type or interfaces for variables unless needed for clarity or exports.
- Use built-in, functional methods for processing arrays and other data structures over loops
- Prefer `const` over `let` unless state mutation is needed.
- Use early returns short circuiting if possible.
- Use early returns/guard clauses; return (or bail) as soon as you know you're done, so the happy path stays flat and you avoid deep nesting.
- For long conditions, break it up into multiple variables to ensure readability.
- Use `Boolean()` instead of `!!` for readability. Do not use falsey values as conditions.
- Avoid empty blocks, especially in `try/catch` statements; use `console.log` or equivalent to fill in the blocks.
- Separate case statements using brackets.
- Use `===` instead of `==` for equality comparisons.
- Use `!==` instead of `!=` for inequality comparisons.
- Use `===` instead of `==` for equality comparisons.

