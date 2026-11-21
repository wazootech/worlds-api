# Agent guidelines

This file overrides the workspace root AGENTS.md for repo-specific guidance.

## What this repo is

This repository contains the Worlds API service.

## How to work here

- Use `package.json` scripts as the source of truth for dev, build, typecheck,
  health, test, and formatting commands.
- Run `pnpm run typecheck` and `pnpm test` for service behavior changes when
  practical.
- Run health checks for API changes that affect runtime behavior. Health checks
  require `WORLDS_API_ADMIN_KEY`.
- Document environment variables and remote-service assumptions before
  finishing.
- Local development brings its own resources: values come from a gitignored
  `.dev.vars` (copy `.dev.vars.example`) or your shell, and are your own, not
  the platform's. The org vault holds only `qa` (legacy) and `prod`; run legacy QA
  commands through `infisical run --env=qa -- <command>`. Never write vault secrets to
  disk.

## Cross-repo impact

- Production is the only auto-deployed environment. The legacy QA Worker and D1
  still exist but CI no longer deploys them and they are being retired; PR
  previews (`worlds-api-preview`) reuse the QA D1/Vectorize. `deploy-prod` runs
  on push to `main` (after `verify`), followed by `canary-prod`, so a green
  `verify` on a pull request is not evidence that the change works live and
  merging **is** deploying. Say so explicitly in the PR body when you could not
  observe it.
- Changing an OpenAPI schema or the World contract requires follow-ups in
  `worlds-client-ts`, then `wazoo-console` / `wazoo-cli`. Name the required
  merge order in the PR.
- `CONTROL_PLANE_DDL` in `src/lib/d1-schema.ts` is the single source of truth
  for the control-plane schema. There is no `schema.sql`; do not reintroduce
  one or a second hand-maintained copy.
- Never hand-edit `openapi/openapi.json`. Regenerate it.
- The Worker admin key is provisioned by the Infisical Cloudflare Workers Secret
  Sync, not by a deploy. Rotating it is a vault edit; the canonical name is
  `WORLDS_API_ADMIN_KEY` (see `secret-registry.md`).

## Agent skills

This repo uses a lightweight skills/config scaffold under docs/agents/. The
canonical triage state labels are defined in docs/agents/triage-labels.md. For
how to file, label, and decide issues, follow docs/agents/issue-tracker.md.
Domain expectations live in docs/agents/domain.md.

## Code health

The `code-health` workflow enforces the family file-size standard on every pull
request: at most 120 lines of code per source file and 300 per test file,
counting neither blank, comment, nor import and re-export lines (including
multi-line ones). A file over its limit fails the check; split it along a real
seam instead of raising the limit. Generated, vendored, schema, snapshot and
fixture paths are exempt. The in-workflow allowlist is empty and may only
shrink. Split modules keep their original path as a re-export barrel, so
imports and the published OpenAPI document do not change.
