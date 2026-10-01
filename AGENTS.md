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
  require `WORLDS_API_ADMIN_KEY`.
- Document environment variables and remote-service assumptions before
  finishing.
- Secrets are injected from Infisical at runtime (`npm run dev`, or
  `infisical run --env=<env> -- <command>`); never write them to disk, and do
  not add code that reads `.env*` or `.dev.vars`.
