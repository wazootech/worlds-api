# Agent guidelines

## What this repo is

This repository contains the Worlds API service.

## How to work here

- Use `package.json` scripts as the source of truth for dev, build, typecheck,
  smoke, test, and formatting commands.
- Run `npm run typecheck` and `npm test` for service behavior changes when
  practical.
- Run smoke checks for API changes that affect runtime behavior.
- Document environment variables and remote-service assumptions before finishing.
