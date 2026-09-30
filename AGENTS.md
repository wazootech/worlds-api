# Agent guidelines

This file overrides the workspace root AGENTS.md for repo-specific guidance.

## What this repo is

This repository contains the Worlds API service.

## How to work here

- Use `package.json` scripts as the source of truth for dev, build, typecheck,
  health, test, and formatting commands.
- Run `npm run typecheck` and `npm test` for service behavior changes when
  practical.
- Run health checks for API changes that affect runtime behavior. Health checks
  require `WORLDS_ADMIN_KEY`.
- Document environment variables and remote-service assumptions before
  finishing.

## Cross-repo impact

- `deploy-qa` and `health-qa` run **only** on push to `main`, so a green
  `verify` here is not evidence that the change works in a live environment.
  Say so explicitly in the PR body when you could not observe it.
- Changing an OpenAPI schema or the World contract requires follow-ups in
  `worlds-client-ts`, then `wazoo-console` / `wazoo-cli`. Name the required
  merge order in the PR.
- `CONTROL_PLANE_DDL` in `src/lib/d1-schema.ts` is the single source of truth
  for the control-plane schema. There is no `schema.sql`; do not reintroduce
  one or a second hand-maintained copy.
- Never hand-edit `openapi/openapi.json`. Regenerate it.
