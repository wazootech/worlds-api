# Contributing to worlds-api

## Local development setup

1. Install dependencies with [pnpm](https://pnpm.io) (version pinned by
   `packageManager`; install it with `npm install -g pnpm`, since Corepack
   cannot run pnpm 12 yet):

   ```sh
   pnpm install
   ```

2. Create your own local environment file. Local development brings its own
   resources, so nothing here needs org credentials. Copy the template and set
   `WORLDS_API_ADMIN_KEY` to any random string you choose; only your local
   instance sees it:

   ```sh
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` is gitignored. Wrangler simulates the D1 binding locally, so you
   need no Cloudflare account to run the service.

3. Start the local dev server:

   ```sh
   pnpm run dev
   ```

4. Run checks:
   ```sh
   pnpm run typecheck
   pnpm run test
   pnpm run format:check
   ```

## Health checks

- Local: `pnpm run health:local`
- Legacy QA (frozen, being retired): `pnpm run health:local https://data-qa.wazoo.dev`
- A PR preview: `pnpm run health:local https://<alias>.preview.data.wazoo.dev`

The script checks `/health` for liveness and `/ready` for the control-plane schema. Its authenticated checks require `WORLDS_API_ADMIN_KEY`.

Against your local instance, export the same key you put in `.dev.vars`:

```sh
WORLDS_API_ADMIN_KEY=<your local key> pnpm run health:local
```

Against the legacy QA Worker, org members with vault access inject the `qa` value:

```sh
infisical run --env=qa -- pnpm run health:local https://data-qa.wazoo.dev
```

## Environment files

The org vault (Infisical) holds only the `qa` (legacy) and `prod` environments.
There is no shared `dev` environment: local development brings its own
resources.

- `.dev.vars` — your own local values (gitignored). Copy it from
  `.dev.vars.example`.
- `.dev.vars.example`, `.env.qa.example`, `.env.production.example` — committed
  templates.
- `.infisical.json` — CLI project link (committed; contains no secrets). Its
  default environment is `qa`. Org members use it with
  `infisical run --env=<qa|prod> -- <command>`.

Never copy a vault value into a local file.

Cloudflare provides the D1 binding; no Turso or libSQL credentials are used.

## CI/CD

GitHub Actions checks pull requests and `main`. It holds no Cloudflare or
Infisical credential and deploys nothing.

### Production deploys

Cloudflare Workers Builds is connected to this repository on the `worlds-api`
Worker. On each push to `main` it runs the checks in its build command and then
`pnpm run deploy`, stamping the commit into `BUILD_GIT_SHA`. A failing check
stops the deploy. The commands and the build token are Worker settings in the
Cloudflare dashboard (Settings, Builds). Builds for other branches are off.

To redeploy the current `main`, retry its latest build on the Worker's
Deployments page.

A deploy ships code, not secrets: the deployed Worker's copy is owned
continuously by the Infisical Cloudflare Workers Secret Sync.

### Verification after a deploy

Production is the only auto-deployed environment. When the `Workers Builds:
worlds-api` check passes on `main`, `post-deploy.yml` makes credential-free
read-only GETs against production (`scripts/prod-canary.mjs`). `/health` reports
the deployed commit as `gitSha`. The legacy QA Worker (`worlds-api-qa`,
`data-qa.wazoo.dev`) and its D1 database still exist, but nothing deploys them
and they are being retired. A secret that rotates with no deploy is not caught
on a timer, so confirm a rotation by hand as below.

**Rotation procedure** — name every consumer, because a rotation that half-lands
is the failure this repo already hit:

1. Edit the value in Infisical (`prod`).
2. Wait for the Cloudflare Workers Secret Sync to report `Synced`.
3. Confirm `pnpm exec wrangler secret list` shows the name
   `WORLDS_API_ADMIN_KEY`.
4. Check `https://data.wazoo.dev/health` and a platform request that uses the
   key.

Consumers of the value, all of which must agree or the platform breaks: this
Worker's own secret and `wazoo-api`'s copy of the admin key.

## Pull request workflow

1. Create a feature worktree from a clean `main` baseline.
2. Make focused, atomic commits.
3. Run `pnpm run format:check`, `pnpm run typecheck`, and `pnpm test` before
   pushing.
4. Open a PR and wait for CI to pass.
