# Contributing to worlds-api

## Local development setup

1. Install dependencies:
   ```sh
   npm install
   ```

2. Copy the local dev vars template:
   ```sh
   cp .dev.vars.example .dev.vars
   ```

3. Fill in `.dev.vars` with real values.

4. Start the local dev server:
   ```sh
   npm run dev
   ```

5. Run checks:
   ```sh
   npm run typecheck
   npm run test
   npm run format:check
   ```

## Health checks

- Local: `npm run health:local`
- QA: `npm run health:local -- https://worlds-api-qa.wazoo.dev`

Health checks require `WORLDS_ADMIN_KEY` to be set.

## Environment files

- `.dev.vars` — local development secrets (gitignored).
- `.env.qa` — QA reference values (gitignored).
- `.env.production` — production reference values (gitignored).
- `.dev.vars.example`, `.env.qa.example`, `.env.production.example` — committed templates.

## Pull request workflow

1. Create a feature worktree from a clean `main` baseline.
2. Make focused, atomic commits.
3. Run `npm run format:check`, `npm run typecheck`, and `npm test` before pushing.
4. Open a PR and wait for CI to pass.
