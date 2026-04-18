# openclaw-managed-agents — Telegram adapter container
#
# First-party deployable that bridges Telegram chats to managed agents.
# Runs as a long-poll worker that talks to Telegram's HTTPS API
# (api.telegram.org) on one side and to the orchestrator's HTTP API
# (http://openclaw-orchestrator:8080 by default) on the other.
#
# Deliberately zero npm runtime deps — the source uses only Node's
# stdlib (fetch, fs, URL). Builds fast, ships ~180 MB, reduces
# supply-chain surface.
#
# Build:
#   docker build -f docker/telegram-adapter/Dockerfile -t openclaw-managed-agents/telegram-adapter:latest .

FROM node:22-slim AS builder

WORKDIR /app
COPY docker/telegram-adapter/package.json docker/telegram-adapter/tsconfig.json ./
COPY docker/telegram-adapter/src ./src
RUN npm install --no-package-lock --silent typescript@5.7.3 @types/node@22.10.2 \
 && npx tsc -p tsconfig.json

FROM node:22-slim

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY docker/telegram-adapter/package.json ./

# /state holds the chat→session mapping (persisted JSON file). Meant to
# be bind-mounted or volume-mounted by the operator so mapping survives
# container replacement. If unmounted, the adapter still boots and
# works but loses chat continuity on restart.
VOLUME /state

# No HTTP port — the adapter uses long-polling outbound to Telegram
# and calls the orchestrator's HTTP API. Nothing listens.
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
