# Contributing to worlds-api

## Local development setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Install and authenticate the Infisical CLI (once per machine). See the
   [Infisical CLI docs](https://infisical.com/docs/cli/overview) for install
   options; on macOS:

   ```sh
   brew install infisical/get-cli/infisical
   infisical login
   ```

   In WSL 2, Codespaces, or a remote SSH session with no browser, use
   `infisical login -i` instead.

3. Link this checkout to the Worlds API project. This writes `.infisical.json`,
   which holds local project settings only — no secret values — and is safe to
   commit:

   ```sh
   infisical init
   ```

4. Start the local dev server. Secrets are pulled from the Development
   environment at process start, so no local secret file is needed:

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
- QA: `npm run health:local -- https://data-qa.wazoo.dev`

The script checks `/health` for liveness and `/ready` for the control-plane schema. Its authenticated checks require `WORLDS_API_ADMIN_KEY`, supplied by Infisical — run it through the CLI so the value is injected:

```sh
infisical run --env=dev -- npm run health:local
infisical run --env=qa -- npm run health:local -- https://data-qa.wazoo.dev
```

## Verifying the wiring

Once the CLI is linked, prove that secrets come from Infisical rather than disk:

```sh
npm run secrets:check
```

The script reports only key names, whether each resolved, and its length — never
a secret value — and exits non-zero if a required secret is missing. Then rename
the legacy `.dev.vars` to `.dev.vars.backup` (already covered by `.gitignore`),
restart `npm run dev`, and confirm the service still starts.

## Environment files

Secrets live in Infisical, keyed by environment (`dev`, `qa`, `prod`). Nothing
secret is written to disk:

- `.infisical.json` — CLI project link (committed; contains no secrets).
- `infisical run --env=<env> -- <command>` — injects secrets into any command,
  for example `infisical run --env=dev -- npm run health:local`.
- `.dev.vars`, `.env.qa`, `.env.production` — legacy local secret files. They
  stay gitignored and are superseded by Infisical; rename `.dev.vars` to
  `.dev.vars.backup` once the CLI is linked so local runs cannot silently fall
  back to disk.
- `.dev.vars.example`, `.env.qa.example`, `.env.production.example` — committed
  templates kept for reference.

Cloudflare provides the D1 binding; no Turso or libSQL credentials are used.

## Verifying the Infisical wiring

Run the check through the CLI. It reports each key name, whether it resolved, and
the length of its value — never the value itself:

```sh
npm run secrets:check
```

It exits non-zero when a required secret is unresolved, which makes it a usable
CI gate. To prove secrets come from Infisical and not from disk, rename the old
`.dev.vars` (or `.env`) to `.dev.vars.backup`, then run `npm run secrets:check`
and `npm run dev` again — both should still work. The check also warns when a
leftover secret file is present, so a pass can't be a false green.

## CI/CD

CI/CD must not use an interactive login. Create a machine identity scoped to the
minimum project and environment it needs, then either:

- use the Infisical OIDC GitHub Action (the pattern already used by `wazoo-api`),
  which needs the `INFISICAL_MACHINE_ID` and `INFISICAL_PROJECT_SLUG` repository
  variables, or
- authenticate with Universal Auth, storing the client ID and client secret in
  the platform's own secret store.

Keep `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in GitHub secrets. See the
[Infisical machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities)
and [Universal Auth](https://infisical.com/docs/documentation/platform/identities/universal-auth)
docs.

### Current wiring

`health-qa` fetches the `qa` environment with `Infisical/secrets-action@v1.0.17`
and `method: oidc`, so `WORLDS_API_ADMIN_KEY` arrives as a job environment
variable. The workflow therefore needs `permissions: id-token: write` and no
long-lived Infisical credential.

This wiring is not live yet. Tracked in
[#97](https://github.com/wazootech/worlds-api/issues/97) (identity + variables),
[#98](https://github.com/wazootech/worlds-api/issues/98) (Worker syncs),
[#99](https://github.com/wazootech/worlds-api/issues/99) (retire the GitHub
secrets), and [#100](https://github.com/wazootech/worlds-api/issues/100)
(commit the working copy).

One-time setup, once per repository:

1. In Infisical, create a machine identity with the subject
   `repo:wazootech/worlds-api:ref:refs/heads/main` and grant it read access to
   the `qa` environment only. Machine identities are per-repository, so this
   cannot be shared with `wazoo-api`.
2. In the repository settings, add the **variables** `INFISICAL_MACHINE_ID` and
   `INFISICAL_PROJECT_SLUG`. These are non-secret; a wrong slug fails the
   action at runtime rather than at merge time.
3. Delete the retired `WORLDS_API_ADMIN_KEY` (and the old `WORLDS_ADMIN_KEY`)
   GitHub secrets. Nothing reads them once the OIDC step is in place.

Copy the subject string from the existing `wazoo-api` identity verbatim and
change only the repo segment. Retyping is where this goes wrong: GitHub uses an
immutable `repo:owner@ID/repo@ID:ref:refs/heads/main` subject for repositories
created after 2026-07-15, and a plain-format subject against an immutable-format
token fails with a 403.

The `deploy-qa` and `deploy-prod` jobs do **not** fetch secrets. `wrangler
deploy` uploads code and sets no secrets; the deployed Worker's copy is owned
continuously by the Infisical Cloudflare Workers Secret Sync. Injecting prod
secrets into a job that cannot use them would only widen exposure.

### The QA canary

Two jobs exercise the QA data plane, and they run the **same** script
(`scripts/local-health.mjs` via `npm run health:local`):

| Job | Workflow | When | Purpose |
| --- | -------- | ---- | ------- |
| `health-qa` | `ci.yml` | push to `main`, after `deploy-qa` | merge-path gate |
| `canary` | `smoke-qa.yml` | daily 06:00 UTC + manual dispatch | drift detection off the merge path |

The canary exists because a merge is a bad place to discover a stale credential.
On 2026-09-25 `health-qa` went red purely because a merge exercised it, while a
branch sitting unmerged — or a secret rotating with no deploy — was invisible
until then. There is deliberately no second health script: two copies of the
check list is how the gate and the canary would come to disagree about what
"healthy" means.

**Rotation procedure** — name every consumer, because a rotation that half-lands
is the failure this repo already hit:

1. Edit the value in Infisical (`qa`, then `prod` separately — the values must
   differ).
2. Wait for the Cloudflare Workers Secret Sync to report `Synced`, or dispatch
   `smoke-qa.yml` to confirm the Worker picked it up.
3. Confirm `npx wrangler secret list --env qa` shows the name
   `WORLDS_API_ADMIN_KEY`.
4. Watch the next `smoke-qa` run, or dispatch it.

Consumers of the QA value, all of which must agree or the platform breaks:
this repo's `health-qa` and `smoke-qa` canary; `wazoo-api`'s `smoke-qa` gate
(same `qa` value, different repo); and the `data-qa` Worker's own secret. The
canary needs the OIDC fetch from above, so it is blocked on
[#97](https://github.com/wazootech/worlds-api/issues/97).

## Pull request workflow

1. Create a feature worktree from a clean `main` baseline.
2. Make focused, atomic commits.
3. Run `npm run format:check`, `npm run typecheck`, and `npm test` before
   pushing.
4. Open a PR and wait for CI to pass.
