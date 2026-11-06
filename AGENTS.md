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
  the platform's. The org vault holds only `qa` and `prod`; run QA commands
  through `infisical run --env=qa -- <command>`. Never write vault secrets to
  disk.

## Cross-repo impact

- `deploy-qa` and `health-qa` run **only** on push to `main`, so a green
  `verify` here is not evidence that the change works in a live environment.
  Say so explicitly in the PR body when you could not observe it. The daily QA
  assertion now lives in `smoke-qa.yml` (`canary`, 06:00 UTC), which reuses
  `health:local`; neither runs on a pull request.
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

Family-wide rules live in the [wazootech workspace constitution](https://github.com/wazootech/workspace/blob/main/AGENTS.md#code-health-standards); this repo's specifics:

- Before pushing, run what CI runs: `pnpm run format:check`, `pnpm run lint` (`--max-warnings 0`), `pnpm run typecheck`, and `pnpm exec vitest run --coverage`.
- Coverage floors live in `vitest.config.ts` and only rise: lines 83, functions 86, branches 73, statements 81. Never lower one to land a change.
- The `openapi-breaking` job (oasdiff, `fail-on: ERR`) blocks breaking changes to `openapi/openapi.json`. Never hand-edit the snapshot or a generated client; regenerate. Downstream chain: `worlds-api` / `wazoo-api` -> `worlds-client-ts` / `wazoo-client-ts` -> `wazoo-console` / `wazoo-cli`. List dependents and merge order in the PR.
- `@typescript-eslint/no-explicit-any` is `error` in `src/` and `scripts/`, and currently **off** in `tests/` until the stacked `typecheck-tests` work (#161) lands and the remaining test `any`s are typed. Fix with real types or `unknown`; the one justified `any` is `respond()`, under an `eslint-disable` with its reason.
- `.gitleaksignore` holds exact fingerprints for verified fixture strings only. Never add regex allowlists or disable a rule. `secret-scan.yml` runs gitleaks on every PR and push to `main`.
- Third-party actions are pinned to full SHAs; CI Node comes from `.node-version` (deploy jobs keep an explicit `node-version`). `code-health.yml` (file length, TODO/FIXME without an issue) is warn-only. `.github/CODEOWNERS` assigns review.
