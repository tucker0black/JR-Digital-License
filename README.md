# JR Digital license

Production foundation for the JR Digital license Telegram Bot and Telegram Mini App. The project is a TypeScript pnpm monorepo with a Fastify API, grammY bot shell, Next.js Mini App, PostgreSQL/Prisma foundation, and Redis/BullMQ foundation.

## Scope of this revision

Development Stages 1–3 are implemented. Stage 3 provides the Telegram bot command layer, Mini App launch menu, command registration, and graceful polling lifecycle. API endpoints and business workflows remain deferred to their separately approved stages.

## Prerequisites

- Node.js 22 or later
- Corepack-enabled pnpm
- Docker Desktop (for local PostgreSQL and Redis)

## Setup

```bash
corepack pnpm install
Copy-Item .env.example .env
docker compose up -d
corepack pnpm build
```

The included `DATABASE_URL` and `REDIS_URL` values target the local Docker Compose services. Apply the initial migration after Docker is healthy:

```bash
corepack pnpm --filter @jr/api exec prisma migrate deploy
```

## Run locally

```bash
# API health endpoint: http://localhost:4000/health (run `corepack pnpm build` first)
corepack pnpm --filter @jr/api start

# Telegram Mini App shell: http://127.0.0.1:3001 (run `corepack pnpm build` first)
corepack pnpm --filter @jr/miniapp dev

# Telegram bot. It reads TELEGRAM_BOT_TOKEN only from the local root .env file.
corepack pnpm --filter @jr/bot start
```

To run all development processes together:

```bash
corepack pnpm dev
```

## Quality checks

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm db:validate
```

`corepack pnpm test:e2e` requires Playwright Chromium to be installed once with `corepack pnpm exec playwright install chromium`.

## Environment variables

Copy `.env.example` and fill in values appropriate to the active stage. Stage 1 needs no real external credentials to run the API or Mini App. `TELEGRAM_BOT_TOKEN` is needed only to start bot polling.

Never commit `.env` or real credentials. The Mini App uses same-origin `/api/*` calls in the browser; Next.js proxies those requests to `API_URL` on the server.

For real Bakong payments, set `BAKONG_ACCOUNT_ID` to the KYC-verified receiving account shown in the Bakong profile. `BAKONG_MERCHANT_ACCOUNT` is not read and a `@bkr`/SIT identifier is rejected. Use `https://api.bakongrelay.com` with an RBK token for Relay mode, or the official production Bakong URL with an official Bakong token. The provider fails closed when the account or token is missing.

## Telegram Mini App through Cloudflare Quick Tunnel

Start the API and Mini App, then expose the Mini App listener only:

```bash
cloudflared tunnel --url http://127.0.0.1:3001
```

Copy the current HTTPS URL printed by `cloudflared` into `MINIAPP_URL` in the root `.env`, then restart the bot so its launch buttons use the current hostname. Quick Tunnel hostnames are temporary and must be updated after every tunnel restart. Do not put the API URL in a `NEXT_PUBLIC_*` variable when the API is local; the browser must call the Mini App origin and let Next.js perform the proxy.

## Local infrastructure

```bash
docker compose up -d
docker compose ps
docker compose down
```

PostgreSQL is exposed on port `5432`; Redis is exposed on `6379`. Docker volumes retain local data across restarts.

## Deployment

Production deployment configuration, Telegram webhook setup, migrations, credentials, monitoring, and CI are deferred to later approved stages.
