# Worlds API

Data-plane API for Wazoo worlds. This repo owns the `worlds-api.wazoo.dev` Cloudflare Worker and the optional Docker image used by VPS compositions.

## Responsibility

- World data metadata inside the data plane.
- Quad/chunk storage backed by libSQL.
- Search, import, and export endpoints.
- World-scoped API keys with the `wzw_` prefix.
- Deployment config for this one service: `wrangler.toml`, `Dockerfile`, `docker-compose.yml`, and CI.

This service treats `namespace` as an opaque grouping string. In Wazoo private beta, `wazoo-api` passes `namespace = user.uid`.

## Routes

- Worlds: `/worlds`, `/worlds/:id`
- Search: `/worlds/:id/search`
- Import: `/worlds/:id/import`
- Export: `/worlds/:id/export`
- API keys: `/api-keys`
- Health: `/health`

Normal data-plane keys resolve namespace from the key. Admin calls pass `namespace` in the request body or query string.

## Configuration

- `LIBSQL_URL`: worlds data libSQL URL, e.g. `file:/data/worlds.db` or `libsql://...`.
- `LIBSQL_AUTH_TOKEN`: optional auth token for remote libSQL.
- `WORLDS_ADMIN_KEY`: admin key used by `wazoo-api` for provisioning and API-key management.

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
