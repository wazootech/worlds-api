# Secret Registry

## Canonical source: Infisical

The canonical source for every runtime secret is the
[Infisical](https://infisical.com) project `wazoo-n-jx-j`. That project's
topology — its environments, folder layout, live inventory, the Cloudflare
Worker syncs, and the rule for where a new secret goes — is recorded in the
private ops home, `wazootech/memory` (`wiki/Infisical_(vault).md`); this file
records only how worlds-api consumes it.

- There is no `dev` environment in the vault. Local development brings its own
  resources: a gitignored `.dev.vars` copied from `.dev.vars.example`, holding
  values you choose yourself. Vault values (`qa`, `prod`) are never copied into
  local files. Org members inject the `qa` value only for QA checks, with
  `infisical run --env=qa -- <command>`.
- `.infisical.json` at the repo root is the committed project link
  (`workspaceId`, `defaultEnvironment: qa`). It holds no secret values and is
  safe to commit. It replaces the interactive `infisical init` step.
- Deployed Worker secrets are owned by an **Infisical Cloudflare Workers Secret
  Sync**, configured in the Infisical dashboard (Project Integrations → Secret
  Syncs). `wrangler deploy` is plain and sets no secrets; provisioning happens
  continuously, independently of deploys.
- Secret **values** are never documented here or in any other file — only
  names, environments, owners, and rotation dates.

## worlds-api

| Secret                 | Infisical env | Prod Worker | QA Worker | Local dev   | Notes                                                                     |
| ---------------------- | ------------- | ----------- | --------- | ----------- | ------------------------------------------------------------------------- |
| `WORLDS_API_ADMIN_KEY` | qa, prod      | via sync    | via sync  | own value   | Platform→data-plane admin key (`wzw_` prefix). Read by `src/env.ts` and accepted as `{ admin: true }` by `src/lib/auth.ts`, bypassing `api_keys`. |
| `EMBEDDING_KEK_V1`     | qa, prod      | **not yet provisioned** | **provisioned** (2026-10-13) | own value (optional) | BYOK key-encryption key (worlds-api#1): base64 of 32 random bytes, one value per environment, QA and prod different. Optional binding: when absent the credential store fails closed (credential routes return 503, search stays keyword-only) and deploys are unaffected. Never rotate by overwriting: add `EMBEDDING_KEK_V2`; records re-wrap lazily on use; retire `_V1` only after a sweep. |
| `EMBEDDING_KEK_V2`     | qa, prod      | rotation only | rotation only | n/a | Optional next KEK. Writes use the highest configured version. |

Only `WORLDS_API_ADMIN_KEY` and the optional `EMBEDDING_KEK_V<n>` secrets are
consumed by this service. The name is canonical
platform-wide — it matches the vault, `wazoo-api`, and the console's registry.
It was previously `WORLDS_ADMIN_KEY` in this repo; that name is retired and will
not resolve. A Worker provisioned with only the old name has **no admin key**,
which looks identical to a failed credential re-seed.

### Non-secret configuration

`WAZOO_ENV`, `PORT`, `CORS_ORIGINS`, `EMBEDDING_PROVIDER`, and the abuse
knobs (`SPARQL_*`, `MAX_IMPORT_*`, `RATE_LIMIT_*`) are configuration, not
secrets.

BYOK embedding configuration (worlds-api#1), all unset by default:

- `EMBEDDING_PROVIDER=byok` turns customer-key embeddings on. Unset (or any
  other value) is the kill switch: every world is keyword-only and no data
  changes. Nothing in `wrangler.toml` sets it; enable per environment only
  after the KEK secret and a QA provider key exist.
- `EMBEDDING_DAILY_BUDGET` (default `20000`): texts one namespace may embed per
  UTC day across index and query operations, enforced in D1 before the provider
  is called.
- `EMBEDDING_REINDEX_MAX_CHUNKS` (default `5000`): texts one reindex call may
  embed.

Customer provider keys are never Worker secrets and are deliberately **not** in
the vault: they live envelope-encrypted (AES-256-GCM, AAD
`namespace|credential_id|provider`) in D1 under the KEK above. The platform's
own evaluation key is a different kind of secret and does live in the vault, at
`/ci` (env `qa`) — a folder no Cloudflare Worker Secret Sync reads. See the
vault record in `wazootech/memory` (`wiki/Infisical_(vault).md`).

## Runtime delivery

| Target            | Path                                                                |
| ----------------- | ------------------------------------------------------------------- |
| Local dev         | `npm run dev` → `scripts/dev.mjs` → `wrangler dev`, reading your own gitignored `.dev.vars` (or shell variables, since `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` makes Wrangler pass them into the Worker). No vault involvement. |
| QA Worker         | Infisical Secret Sync (project `wazoo-n-jx-j`, source `/worlds-api`, env `qa`) → script `worlds-api-qa`. Deletion protection **on**. |
| Prod Worker       | Infisical Secret Sync (project `wazoo-n-jx-j`, source `/worlds-api`, env `prod`) → script `worlds-api`. Deletion protection **on**. |
| CI (`health-qa`, `smoke-qa`) | `Infisical/secrets-action@v1.0.17` with `method: oidc`, env `qa`, `secret-name: WORLDS_API_ADMIN_KEY`, per-repo machine identity subject `repo:wazootech@197434733/worlds-api@1299570979:ref:refs/heads/main`. Reads project `wazoo-n-jx-j` via `INFISICAL_PROJECT_SLUG`. Needs `permissions: id-token: write` and the `INFISICAL_MACHINE_ID` / `INFISICAL_PROJECT_SLUG` repository **variables**. |
| CI (deploy jobs)  | Named Infisical fetch, no GitHub secret: `deploy-qa` and `deploy-prod` use `Infisical/secrets-action@v1.0.17` with `method: oidc` and `secret-name: CLOUDFLARE_API_TOKEN` and `secret-path: /ci`, env `qa` and `prod` respectively (same identity and variables as above). The deploy credential lives at vault folder `/ci`, deliberately outside any sync's scope, so no sync binds it onto a Worker. `CLOUDFLARE_ACCOUNT_ID` comes from the `CLOUDFLARE_ACCOUNT_ID` repository **variable**. Only the deploy token is injected; `wrangler deploy` sets no Worker secrets, and the Worker copy belongs to the sync. |

## Operational notes

- **Ordering mattered.** The rename to `WORLDS_API_ADMIN_KEY` landed in code
  first and the Secret Sync that publishes that name to Cloudflare was created
  after. Deploying to QA in the window between the two would have left the
  Worker with no admin key. Both halves are now done and verified.
- **Verify, don't assume.** `npx wrangler secret list --env qa` should show
  `WORLDS_API_ADMIN_KEY`. An authenticated probe through
  `infisical run --env=qa -- npm run health:local -- https://data-qa.wazoo.dev`
  confirms the value the Worker actually holds is the one in the vault.
- **Rotation** is a vault edit: change the value in Infisical and let the sync
  push it. No Cloudflare command, no CI secret, and no deploy is required. The
  QA and prod values must differ, and the QA value must match what
  `wazoo-api` sends.
- **Deletion protection is on for both syncs.** Neither the QA nor the prod
  worlds-api sync will remove a secret from the Worker when it disappears from
  the source path. That is deliberate: the value is shared platform-wide, and an
  accidental removal would take the data plane's admin auth with it.
- **No long-lived copies remain.** The `WORLDS_ADMIN_KEY` and
  `WORLDS_API_ADMIN_KEY` GitHub secrets are retired: CI fetches the value via
  OIDC and the Workers get it via the sync. No workflow reads a GitHub secret:
  both deploy jobs fetch `CLOUDFLARE_API_TOKEN` from the vault folder `/ci` (`qa` / `prod`)
  and read the account ID from a repository variable. The legacy
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub secrets were
  deleted on 2026-10-10, after a prod deploy succeeded on the vault token
  ([workspace-v1#184](https://github.com/wazootech/workspace-v1/issues/184)); this
  repo has no GitHub Actions secrets.

## Single source of truth for `WORLDS_API_ADMIN_KEY`

The canonical value lives at the root of the shared `wazoo-n-jx-j` project,
environment `qa` and `prod`. The `/worlds-api` folder holds a **literal copy**
(checked 2026-10-18; it is not an Infisical reference), and the two Worker syncs
source from that folder. Rotating the key means editing root, `/worlds-api` and
`/wazoo-api` in the same environment. The QA and prod values differ by design.

An earlier arrangement kept a second literal copy in an isolated `worlds-api`
Infisical project that CI read directly. That project is retired as a source:
only the shared project is authoritative. Because Infisical references cannot
cross projects, collapsing the duplicate meant pointing this repo's CI at the
shared project (`INFISICAL_PROJECT_SLUG=wazoo-n-jx-j`) and adding the
`worlds-api-ci` identity to it as a viewer. The least-privilege control that
keeps that widening small is the CI fetch itself: `secret-name:
WORLDS_API_ADMIN_KEY` injects only that one key into the job. Per-secret role
scoping is not available on the current plan, so the identity's read scope is
broader than the fetch.

## Outstanding work

| #                                                                              | Action                                                                                       | Status          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------- |
| [#97](https://github.com/wazootech/worlds-api/issues/97)                      | Create this repo's Infisical machine identity and the `INFISICAL_MACHINE_ID` / `INFISICAL_PROJECT_SLUG` repository variables | **Closed** — identity `worlds-api-ci`, subject in the immutable `repo:wazootech@197434733/worlds-api@1299570979:ref:refs/heads/main` form |
| [#98](https://github.com/wazootech/worlds-api/issues/98)                      | Create the `worlds-api-qa` and `worlds-api-prod` Cloudflare Workers Secret Syncs, reusing the shared App Connection | **Closed** — both `Synced`, deletion protection on |
| [#99](https://github.com/wazootech/worlds-api/issues/99)                      | Delete the retired `WORLDS_ADMIN_KEY` and `WORLDS_API_ADMIN_KEY` GitHub Actions secrets      | **Closed** — neither name remains as a GitHub secret |
| [#100](https://github.com/wazootech/worlds-api/issues/100)                    | Commit and PR the uncommitted working copy                                                     | **Closed** — merged as #101 / #102 |
| [#80](https://github.com/wazootech/worlds-api/issues/80)                      | Scheduled QA canary `.github/workflows/smoke-qa.yml` (daily 06:00 UTC)                         | **Closed** — green on a real scheduled run |

### Remaining gap: the production deploy

**Resolved.** Production ran the cutover on 2026-10-05, following the runbook
added in commit `8caa8a2` ("docs: add the production worlds D1 reset
runbook"). Verified live read-only against `data.wazoo.dev`:

- `GET /health` → 200 `{"status":"ok"}`
- `GET /ready` → 200 `{"status":"ready"}`
- `GET /worlds` (no auth) → 401 — bearer-only, fail-closed
- `GET /worlds` (bearer `$WORLDS_API_ADMIN_KEY`) → 200 `{"worlds":[]}`
- D1 `worlds` PK is `world_id TEXT NOT NULL PRIMARY KEY`; schema version is 4
  (applied 2026-10-05 20:03:10).

The production reset followed the procedure in `docs/prod-d1-reset-runbook.md`.
This closes the schema gate only: later `main` pipeline runs can still fail on
unrelated deploy steps, so check the latest `ci` run before assuming a deploy.

Last audited: 2026-10-18
