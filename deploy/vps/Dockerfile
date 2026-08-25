# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/miniapp/package.json ./apps/miniapp/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @jr/shared build
RUN pnpm --filter @jr/api db:generate
RUN pnpm --filter @jr/api build
RUN pnpm --filter @jr/bot build

# API_URL is intentionally server-side. It is used by next.config.ts when the
# Mini App build creates its /api/* rewrite destination.
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_SUPPORT_TELEGRAM_URL=
ARG NEXT_PUBLIC_DEV_AUTH_ENABLED=false

ENV API_URL=${API_URL}
ENV NEXT_PUBLIC_SUPPORT_TELEGRAM_URL=${NEXT_PUBLIC_SUPPORT_TELEGRAM_URL}
ENV NEXT_PUBLIC_DEV_AUTH_ENABLED=${NEXT_PUBLIC_DEV_AUTH_ENABLED}

RUN pnpm --filter @jr/miniapp build

FROM build AS api

WORKDIR /app/apps/api

ENV NODE_ENV=production

# Compose supplies runtime environment variables. Do not use the local
# package start script here because it expects ../../.env to exist in the
# container filesystem.
CMD ["node", "dist/index.js"]

FROM build AS bot

WORKDIR /app/apps/bot

ENV NODE_ENV=production

# The bot has no listener; it maintains one Telegram long-polling connection.
CMD ["node", "dist/index.js"]

FROM build AS miniapp

WORKDIR /app/apps/miniapp

ENV NODE_ENV=production

CMD ["pnpm", "start"]
