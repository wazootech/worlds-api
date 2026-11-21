# Worlds API

Data-plane API for Wazoo worlds. This repo owns the `data.wazoo.dev`
Cloudflare Worker and the optional Docker image used by VPS compositions.

## Responsibility

- World data metadata inside the data plane.
- Quad/chunk storage backed by Cloudflare D1.
- Search, import, and export endpoints.
- World-scoped API keys with the `wzw_` prefix.
- Deployment config for this one service: `wrangler.toml`, `Dockerfile`,
  `docker-compose.yml`, and CI.

This service treats `namespace` as an opaque grouping string. In Wazoo private
beta, `wazoo-api` passes `namespace = user.uid`.

## Architecture and boundaries

The Wazoo Worlds surface is split into two planes, each with its own auth
surface and its own client package:

| Plane                 | Service                         | Auth                     | Owns                                                                                                                           | Client                                                                                 |
| --------------------- | ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Platform (management) | `wazoo-api` (`api.wazoo.dev`)   | platform tokens (`wzp_`) | accounts, platform tokens, usage/limits/billing, and the _policy facade_ over worlds                                           | `@wazoo/client` (generated from the platform OpenAPI)                                  |
| Data plane            | `worlds-api` (`data.wazoo.dev`) | world keys (`wzw_`)      | world data in shared Cloudflare D1, metadata, keys, quad/chunk storage, search/SPARQL/import/export/reindex, lifecycle + purge | the generated `@worlds/client` data-plane HTTP client and the embeddable `@worlds/sdk` |

### The cut (intentional)

- **The data plane is the single writer of world lifecycle and world keys.**
  `POST /worlds` inserts world metadata into the shared D1 `worlds` table;
  `/api-keys` mints data-plane keys. A self-hosted
  `worlds-api` is therefore fully functional standalone — worlds, keys, and data
  operations — with zero management-plane dependency. That is the original
  design goal: people can self-host the data plane without running the platform.
- **The platform plane is a policy facade over the data plane.** `wazoo-api`
  `/v1/worlds` CRUD and world-token endpoints call `worlds-api` admin endpoints
  (`/api-keys`, world lifecycle) with `WORLDS_API_ADMIN_KEY`, then layer
  platform policy on top: quotas, usage/limits, billing gates, and
  `MAX_WORLDS_EXCEEDED`. The two `/worlds` surfaces are not peers — one is
  storage ownership, the other is policy.
- `namespace` is the tenancy boundary between the planes: an opaque grouping
  string (in the hosted beta, `wazoo-api` passes `namespace = user.uid`).
  Data-plane keys resolve namespace from the key; admin calls pass it
  explicitly.

### Where cuts are supposed to go (decision record)

The historical confusion about "where do cuts go" comes from three overlaps that
were never explicitly resolved. This section resolves them:

1. **World CRUD appears twice.** `/worlds` (data plane) and `/v1/worlds`
   (platform) look duplicated. Decision: keep the data plane as the sole writer
   of world lifecycle and metadata; the platform facade must not persist its own
   world state. Platform-side world policy (quotas, billing, usage) is derived
   state, not a second world record.
2. **World keys are minted in two places.** `worlds-api /api-keys` is the
   minting authority; `wazoo-api /v1/worlds/{worldId}/auth/tokens` is a scoped
   facade that already mints through the data-plane admin surface. Keep one mint
   (the data plane); the platform endpoint stays a thin alias and must not mint
   independently.
3. **The hosted beta is a proxy, not the model.** In the hosted beta,
   `wazoo-api` provisions everything through `WORLDS_API_ADMIN_KEY`. That admin
   surface is an implementation detail of the platform facade, not a second
   public API; self-hosted deployments use the same endpoints with their own
   admin key.

### Consequences for client packages

- `@wazoo/client` covers the platform plane only (management-plane operations).
- The data plane needs its own typed HTTP client generated from this repo's
  OpenAPI document (`GET /openapi.json`), replacing hand-rolled `fetch` in
  consumers such as `wazoo-cli`.
- `@worlds/sdk` is the embeddable SDK (in-process graph operations over any
  backend). Its `import`/`export`/`search`/`sparql`/`reindex` methods must stay
  shape-identical with the data-plane HTTP endpoints so the SDK and the HTTP
  client expose one contract.

## Routes

- Worlds: `/worlds`, `/worlds/:worldId`
- Search: `/worlds/:worldId/search`
- Import: `/worlds/:worldId/import`
- Export: `/worlds/:worldId/export`
- API keys: `/api-keys`
- Liveness: `/health`
- Readiness: `/ready`

## World identity

Worlds API mints `w_<ULID>` IDs; clients provide display name and optional configuration, not a slug or ID. World responses expose the value as `id`, storage uses `world_id`, and every world-scoped route uses the same value as its `worldId` path parameter. There is no slug or legacy-identity fallback.

Normal data-plane keys resolve namespace from the key. Admin calls pass
`namespace` in the request body or query string.

The `/admin/namespaces/{namespace}/delete` and `/admin/purge` endpoints are
admin-only and exist for the platform facade and account-deletion flows.

## World lifecycle

![A world's lifecycle. The owner asks to create a world; wazoo-api checks quota and either refuses with MAX_WORLDS_EXCEEDED or calls worlds-api with the admin key, which creates the world and mints a world key shown once. While in use the owner can suspend and resume it. Deleting soft-deletes the world; for 30 days the owner can undelete it, after which a daily sweep purges its vectors and quads permanently.](docs/diagrams/world-lifecycle.svg)

Time runs left to right; the stroke shows who is acting and the red diamonds are
the steps that cannot be undone. Deleting a world is a soft delete: the world
enters a 30-day grace period during which `POST /worlds/{worldId}/undelete`
restores it. After that, the daily purge sweep (the `0 0 * * *` cron, or
`/admin/purge` to force it) deletes the world's vectors, then its quads, and
marks it purged. Purged worlds cannot be restored.

The diagram is generated from
[`docs/diagrams/world-lifecycle.feynman.json`](docs/diagrams/world-lifecycle.feynman.json)
with the [`feynman-diagram`](https://github.com/EthanThatOneKid/feynman-diagram)
skill.

## Configuration

- `WORLDS_API_ADMIN_KEY`: admin key used by `wazoo-api` for provisioning and API-key
  management. This is the only secret worlds-api reads.

Deployed secrets live in Infisical (`qa` and `prod`) and reach the Workers
through the Cloudflare Workers Secret Sync. Local development brings its own
resources and uses your own `.dev.vars`; it needs no org credentials. See
[CONTRIBUTING.md](CONTRIBUTING.md) for local setup and
[secret-registry.md](secret-registry.md) for how the Workers Secret Sync and CI
each receive the deployed values.

Worlds API's control-plane DDL is defined in `src/lib/d1-schema.ts`. The
`@worlds/cloudflare` package owns data-plane tables, indexes, and schema
compatibility checks. Schema initialization is not an in-place migration; any
database reset remains a separately approved rollout action.

## Health checks

- Local: `pnpm run health:local`
- QA: `pnpm run health:local https://data-qa.wazoo.dev`

`/health` checks liveness and database connectivity. `/ready` checks that the
control-plane schema matches this service. The health script probes both and
requires `WORLDS_API_ADMIN_KEY` for its authenticated checks. Export your local
key for a local run, or inject the `qa` value (org members) for QA:

```sh
WORLDS_API_ADMIN_KEY=<your local key> pnpm run health:local
infisical run --env=qa -- pnpm run health:local https://data-qa.wazoo.dev
```

## Development

```sh
pnpm install
cp .dev.vars.example .dev.vars   # then set your own WORLDS_API_ADMIN_KEY
pnpm run dev
pnpm run typecheck
pnpm run build
```

## Deployment

Cloudflare Worker:

```sh
pnpm run deploy --dry-run
pnpm run deploy
```

Docker component:

```sh
docker build -t ghcr.io/wazootech/worlds-api:latest .
docker compose up
```

GitHub Actions validates formatting, typechecking, build, Worker dry deploy,
Docker build, publishes the GHCR image on `main`, and deploys
`data.wazoo.dev` on `main`.

### PR previews

GitHub Actions does not deploy pull requests. Previews come from Cloudflare
Workers Builds using `wrangler.preview.toml`: a separate `worlds-api-preview`
Worker whose build token is scoped to it alone, so it can't deploy prod. Each
branch gets `<alias>.preview.data.wazoo.dev` (`WAZOO_ENV="preview"`), and the
console previews at `*.preview.console.wazoo.dev` are allowed by CORS there
(never on prod).

Previews **share the QA resources** (the `worlds-api-qa` D1 database and the QA
Vectorize index; no new resources). A PR that changes `CONTROL_PLANE_DDL` needs
its migration applied to `worlds-api-qa` by hand before its preview works, and
branch code has write access to that data, so treat write access to this repo
as access to it. The preview has no cron trigger.

Workers Builds settings (Worker `worlds-api-preview`, connected to this repo):

- Root directory `/`; build command empty (wrangler bundles `src/index.ts`).
- Deploy command (production branch `main`):
  `npx wrangler deploy -c wrangler.preview.toml`
- Non-production branch deploy command:
  `npx wrangler versions upload -c wrangler.preview.toml`
  (`pnpm run versions:preview` is the same command).
- Enable non-production branch builds. In Domains & Routes, Previews Base tab,
  keep preview URLs on and select `preview.data.wazoo.dev` as the base.
- Secret `WORLDS_API_ADMIN_KEY` set on this Worker with a preview-only value
  (not the QA or prod value). Set `EMBEDDING_KEK_V1` only to exercise BYOK
  embeddings, also with its own value.
