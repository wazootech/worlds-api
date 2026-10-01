# Secret Registry

## Canonical source: Infisical

The canonical source for every runtime secret is the
[Infisical](https://infisical.com) project described in the workspace-level
migration runbook (`infisical-secrets-migration.md` at the root of the
wazootech workspace repo). That runbook owns the full inventory, the
dev/qa/prod separation, and the cutover sequence; this file records only how
worlds-api consumes it.

- Local secret files (`.env`, `.dev.vars`) are **retired**. There is no
  committed copy in this repo's history and nothing needs rotating on account
  of the migration. Secrets reach local processes by injection:
  `infisical run --env=dev -- npm run dev` (or `npm run secrets:check` to
  confirm what resolved, printing names and lengths only).
- `.infisical.json` at the repo root is the committed project link
  (`workspaceId`, `defaultEnvironment: dev`). It holds no secret values and is
  safe to commit. It replaces the interactive `infisical init` step.
- Deployed Worker secrets are owned by an **Infisical Cloudflare Workers Secret
  Sync**, configured in the Infisical dashboard (Project Integrations → Secret
  Syncs). `wrangler deploy` is plain and sets no secrets; provisioning happens
  continuously, independently of deploys.
- Secret **values** are never documented here or in any other file — only
  names, environments, owners, and rotation dates.

## worlds-api

| Secret                 | Infisical env | Prod Worker | QA Worker | Local `dev` | Notes                                                                     |
| ---------------------- | ------------- | ----------- | --------- | ----------- | ------------------------------------------------------------------------- |
| `WORLDS_API_ADMIN_KEY` | dev, qa, prod | via sync    | via sync  | injected    | Platform→data-plane admin key (`wzw_` prefix). Read by `src/env.ts` and accepted as `{ admin: true }` by `src/lib/auth.ts`, bypassing `api_keys`. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | qa, prod | not consumed | not consumed | n/a | Present in the vault for sibling services; worlds-api does not read it.   |

Only `WORLDS_API_ADMIN_KEY` is consumed by this service. The name is canonical
platform-wide — it matches the vault, `wazoo-api`, and the console's registry.
It was previously `WORLDS_ADMIN_KEY` in this repo; that name is retired and will
not resolve. A Worker provisioned with only the old name has **no admin key**,
which looks identical to a failed credential re-seed.

### Non-secret configuration

`WAZOO_ENV`, `PORT`, `CORS_ORIGINS`, `EMBEDDING_PROVIDER`, and the abuse
knobs (`SPARQL_*`, `MAX_IMPORT_*`, `RATE_LIMIT_*`) are configuration, not
secrets. They live in `wrangler.toml` `[vars]` / `[env.qa.vars]` or in the local
shell, and are deliberately **not** in the vault.

## Runtime delivery

| Target            | Path                                                                |
| ----------------- | ------------------------------------------------------------------- |
| Local dev         | `npm run dev` → `scripts/dev.mjs` → `wrangler dev` under `infisical run --env=dev`; `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` makes Wrangler pass the injected values into the Worker. |
| QA Worker         | Infisical Secret Sync (source `/` env `qa`) → script `worlds-api-qa`.  |
| Prod Worker       | Infisical Secret Sync (source `/` env `Production`) → script `worlds-api`. |
| CI (`health-qa`, `smoke-qa`) | `Infisical/secrets-action@v1.0.17` with `method: oidc`, env `qa`, per-repo machine identity subject `repo:wazootech/worlds-api:ref:refs/heads/main`. Needs `permissions: id-token: write` and the `INFISICAL_MACHINE_ID` / `INFISICAL_PROJECT_SLUG` repository **variables**. |
| CI (deploy jobs)  | No secrets injected. `wrangler deploy` sets none, and the Worker copy belongs to the sync. |

## Operational notes

- **Ordering matters.** The rename to `WORLDS_API_ADMIN_KEY` landed in code
  first; the Secret Sync that publishes that name to Cloudflare is created
  after. Do not deploy to QA between those two events, or the Worker will have
  no admin key.
- **Verify, don't assume.** `npx wrangler secret list --env qa` should show
  `WORLDS_API_ADMIN_KEY`. An authenticated probe through
  `infisical run --env=qa -- npm run health:local -- https://data-qa.wazoo.dev`
  confirms the value the Worker actually holds is the one in the vault.
- **Rotation** is a vault edit: change the value in Infisical and let the sync
  push it. No Cloudflare command, no CI secret, and no deploy is required. The
  QA and prod values must differ, and the QA value must match what
  `wazoo-api` sends.
- **No long-lived copies remain.** The `WORLDS_ADMIN_KEY` and
  `WORLDS_API_ADMIN_KEY` GitHub secrets are retired: CI fetches the value via
  OIDC and the Workers get it via the sync. GitHub retains only
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets.

## Outstanding work

The code side of this cutover is done and verified, but the dashboard and repo
settings are not. Tracked in `wazootech/worlds-api`:

| #                                                                              | Action                                                                                       | Blocks          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------- |
| [#97](https://github.com/wazootech/worlds-api/issues/97)                      | Create this repo's Infisical machine identity (subject `repo:wazootech/worlds-api:ref:refs/heads/main`) and the `INFISICAL_MACHINE_ID` / `INFISICAL_PROJECT_SLUG` repository variables | #99, merge      |
| [#98](https://github.com/wazootech/worlds-api/issues/98)                      | Create the `worlds-api-qa` and `worlds-api-prod` Cloudflare Workers Secret Syncs, reusing the shared App Connection | **merge**      |
| [#99](https://github.com/wazootech/worlds-api/issues/99)                      | Delete the retired `WORLDS_ADMIN_KEY` and `WORLDS_API_ADMIN_KEY` GitHub Actions secrets      | —               |
| [#100](https://github.com/wazootech/worlds-api/issues/100)                    | Commit and PR the uncommitted working copy                                                     | —               |
| [#80](https://github.com/wazootech/worlds-api/issues/80)                      | Canary landed in the working copy as `.github/workflows/smoke-qa.yml` (daily 06:00 UTC); close it once a real scheduled run is green | —               |

As of 2026-09-30 the changes above exist only as an uncommitted working-copy
diff, so this file is not yet on `main` either.

Last audited: 2026-09-30
