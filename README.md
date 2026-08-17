# Worlds API

Data-plane API for Wazoo worlds. This repo owns the `worlds-api.wazoo.dev` Cloudflare Worker and the optional Docker image used by VPS compositions.

## Responsibility

- World data metadata inside the data plane.
- Quad/chunk storage backed by libSQL.
- Search, import, and export endpoints.
- World-scoped API keys with the `wzw_` prefix.
- Deployment config for this one service: `wrangler.toml`, `Dockerfile`, `docker-compose.yml`, and CI.

This service treats `namespace` as an opaque grouping string. In Wazoo private beta, `wazoo-api` passes `namespace = user.uid`.

## Architecture and boundaries

The Wazoo Worlds surface is split into two planes, each with its own auth
surface and its own client package:

| Plane | Service | Auth | Owns | Client |
| ----- | ------- | ---- | ---- | ------ |
| Platform (management) | `wazoo-api` (`api.wazoo.dev`) | platform tokens (`wzp_`) | accounts, platform tokens, usage/limits/billing, and the *policy facade* over worlds | `@wazoo/client` (generated from the platform OpenAPI) |
| Data plane | `worlds-api` (`worlds-api.wazoo.dev`) | world keys (`wzw_`) | world *data*: per-world LibSQL databases, `worlds_metadata`, `api_keys`, quad/chunk storage, search/SPARQL/import/export/reindex, lifecycle + purge | a data-plane HTTP client (not yet generated) and the embeddable `@worlds/client` SDK |

### The cut (intentional)

- **The data plane is the single writer of world lifecycle and world keys.**
  `POST /worlds` provisions the per-world database and persists
  `worlds_metadata`; `/api-keys` mints data-plane keys. A self-hosted
  `worlds-api` is therefore fully functional standalone — worlds, keys, and
  data operations — with zero management-plane dependency. That is the
  original design goal: people can self-host the data plane without running
  the platform.
- **The platform plane is a policy facade over the data plane.** `wazoo-api`
  `/v1/worlds` CRUD and world-token endpoints call `worlds-api` admin
  endpoints (`/api-keys`, world lifecycle) with `WORLDS_API_ADMIN_KEY`, then
  layer platform policy on top: quotas, usage/limits, billing gates, and
  `MAX_WORLDS_EXCEEDED`. The two `/worlds` surfaces are not peers — one is
  storage ownership, the other is policy.
- `namespace` is the tenancy boundary between the planes: an opaque grouping
  string (in the hosted beta, `wazoo-api` passes `namespace = user.uid`).
  Data-plane keys resolve namespace from the key; admin calls pass it
  explicitly.

### Where cuts are supposed to go (decision record)

The historical confusion about "where do cuts go" comes from three overlaps
that were never explicitly resolved. This section resolves them:

1. **World CRUD appears twice.** `/worlds` (data plane) and `/v1/worlds`
   (platform) look duplicated. Decision: keep the data plane as the sole
   writer of world lifecycle and metadata; the platform facade must not
   persist its own world state. Platform-side world policy (quotas, billing,
   usage) is derived state, not a second world record.
2. **World keys are minted in two places.** `worlds-api /api-keys` is the
   minting authority; `wazoo-api /v1/worlds/{worldId}/auth/tokens` is a
   scoped facade that already mints through the data-plane admin surface.
   Keep one mint (the data plane); the platform endpoint stays a thin alias
   and must not mint independently.
3. **The hosted beta is a proxy, not the model.** In the hosted beta,
   `wazoo-api` provisions everything through `WORLDS_API_ADMIN_KEY`. That
   admin surface is an implementation detail of the platform facade, not a
   second public API; self-hosted deployments use the same endpoints with
   their own admin key.

### Consequences for client packages

- `@wazoo/client` covers the platform plane only (management-plane
  operations).
- The data plane needs its own typed HTTP client generated from this repo's
  OpenAPI document (`GET /openapi.json`), replacing hand-rolled `fetch` in
  consumers such as `wazoo-cli`.
- `@worlds/client` is the embeddable SDK (in-process graph operations over
  any backend). Its `import`/`export`/`search`/`sparql`/`reindex` methods
  must stay shape-identical with the data-plane HTTP endpoints so the SDK and
  the HTTP client expose one contract.

## Routes

- Worlds: `/worlds`, `/worlds/:id`
- Search: `/worlds/:id/search`
- Import: `/worlds/:id/import`
- Export: `/worlds/:id/export`
- API keys: `/api-keys`
- Health: `/health`

Normal data-plane keys resolve namespace from the key. Admin calls pass `namespace` in the request body or query string.

The `/admin/namespaces/{namespace}/delete` and `/admin/purge` endpoints are
admin-only and exist for the platform facade and account-deletion flows.

## Configuration

- `LIBSQL_URL`: worlds data libSQL URL, e.g. `file:/data/worlds.db` or `libsql://...`.
- `LIBSQL_AUTH_TOKEN`: optional auth token for remote libSQL.
- `WORLDS_ADMIN_KEY`: admin key used by `wazoo-api` for provisioning and API-key management.

## Health checks

- Local: `npm run health:local`
- QA: `npm run health:local -- https://worlds-api-qa.wazoo.dev`

Requires `WORLDS_ADMIN_KEY` to exercise authenticated endpoints.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
npm run typecheck
npm run build
```

## Deployment

Cloudflare Worker:

```sh
npm run deploy -- --dry-run
npm run deploy
```

Docker component:

```sh
docker build -t ghcr.io/wazootech/worlds-api:latest .
docker compose up
```

GitHub Actions validates formatting, typechecking, build, Worker dry deploy, Docker build, publishes the GHCR image on `main`, and deploys `worlds-api.wazoo.dev` on `main`.
