# Telegram adapter

First-party bridge between Telegram chats and `openclaw-managed-agents`.
Each Telegram user's conversation maps to one persistent managed-agent
session. `docker compose --profile telegram up -d` is the zero-glue
experience.

## What it does

1. Long-polls Telegram's `getUpdates` for inbound messages.
2. For each new chat, creates an agent session (via your orchestrator's
   `POST /v1/sessions`) and persists the chat→session mapping in
   `/state/chats.json`.
3. Posts each incoming user message as a `user.message` event on that
   session.
4. Shows a "typing…" indicator while the agent runs.
5. When the session flips to idle, posts the last `agent.message`
   content back to Telegram, splitting into chunks if >4000 chars.

## Non-goals (v1)

- No webhook mode — long-polling only. Works behind NAT without
  terminating HTTPS.
- No tool-confirmation flow — use `always_allow` agents here. The
  `always_ask` approval round-trip is designed for UIs (portal),
  not channels.
- No per-message streaming — Telegram doesn't natively stream inside
  one message. Agent reasoning is visible in the orchestrator's web
  portal instead.
- No multi-agent routing — one adapter instance serves one agent.
  Deploy multiple adapter containers for multiple bots/agents.

## Configuration

Required env vars:

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/botfather). Format: `<bot_id>:<secret>`. |
| `OPENCLAW_AGENT_ID` | The managed agent to route messages to. Create via `POST /v1/agents` first and pass the returned `agent_id` here. |

Optional env vars:

| Variable | Default | Purpose |
|---|---|---|
| `OPENCLAW_ORCHESTRATOR_URL` | `http://openclaw-orchestrator:8080` | Where the orchestrator HTTP API lives. |
| `OPENCLAW_API_TOKEN` | unset | Forward as `Authorization: Bearer` on every orchestrator call if your deployment enables auth. |
| `STORAGE_PATH` | `/state/chats.json` | Where to persist the chat→session map. |
| `POLL_TIMEOUT_SECONDS` | `25` | Long-poll hold time handed to Telegram. 1-60. |
| `MAX_UPDATE_AGE_SECONDS` | `300` | Drop messages older than this on startup (don't replay a week of queued chats after a long outage). |
| `TURN_TIMEOUT_MS` | `300000` | How long to wait for a session to go from running→idle before telling the user to try again. |

## Quickstart

1. Get a bot token from [@BotFather](https://t.me/botfather). Note the
   bot's username so users can find it.
2. Create an agent:
   ```bash
   curl -sX POST http://localhost:8080/v1/agents \
     -H 'Content-Type: application/json' \
     -d '{"model":"moonshot/kimi-k2.5","instructions":"You are a friendly assistant."}' \
     | jq -r .agent_id
   # => agt_XXXXXXXX
   ```
3. Add both to your `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABCdefGhi...
   OPENCLAW_TELEGRAM_AGENT_ID=agt_XXXXXXXX
   ```
4. Start the adapter:
   ```bash
   docker compose --profile telegram up -d
   ```
5. Message your bot on Telegram. It replies.

## Production notes

- The adapter is stateless except for `/state/chats.json`. Back it up
  if chat continuity matters, or accept that restart = fresh sessions
  per chat. The orchestrator's sessions themselves survive anyway; the
  mapping file just links Telegram chats to them.
- One bot = one adapter container. Deploying multiple adapters with
  the same `TELEGRAM_BOT_TOKEN` will cause Telegram to alternate
  updates between them, corrupting the offset cursor. Use one.
- The adapter has no open TCP ports — it only calls outbound
  (api.telegram.org and the orchestrator). Safe to run on a host
  without incoming firewall rules.
- Message privacy: if your bot is in a group, Telegram delivers
  messages to it only when it's @mentioned OR configured in BotFather
  to receive all messages ("disable privacy mode"). v1 treats every
  message the bot receives as addressed to it; the chat-level privacy
  setting is the operator's choice.

## Limitations this adapter has today

- **Private chats work naturally; groups work with privacy-mode off.**
  A group chat and a DM on the same bot map to different `chat.id`s so
  the sessions are independent — but within a group, every user's
  message goes to the same shared session. That's a design choice (the
  bot is "one agent in the group room"), not a bug. For per-user
  sessions in groups, run a different adapter layout.
- **No file / photo / voice input.** v1 handles `message.text` only.
- **No message editing.** If a user edits a prior message, Telegram
  delivers an `edited_message` update which we ignore.

These are fine starting-set limitations. Extend as users ask.
