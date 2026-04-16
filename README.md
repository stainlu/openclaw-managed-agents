# OpenClaw Managed Agents

The open alternative to Claude Managed Agents. Run autonomous AI agents via API — any model, any cloud, open source.

## Why this exists

Anthropic's [Claude Managed Agents](https://www.anthropic.com/engineering/managed-agents) is Claude-only, Anthropic-hosted, and charges $0.08/session-hour on top of tokens. OpenClaw Managed Agents is the open counter: same architectural pattern (stateless orchestrator + per-session container + append-only event log), but you pick the model, you pick the cloud, and there's no platform tax.

| | Claude Managed Agents | OpenClaw Managed Agents |
|---|---|---|
| Models | Claude only | Any — Anthropic, OpenAI, Gemini, Moonshot, DeepSeek, Mistral, xAI, and [15+ more](https://openclaw.ai) |
| Hosting | Anthropic's cloud only | Any cloud or VPS with Docker — from $0/month (Oracle free tier) to $4/month (Hetzner) |
| Source | Closed | Open source (MIT) |
| Platform tax | $0.08/session-hour | None |
| Data | Anthropic's infrastructure | Your disk, your VPC, your control |
| Multi-agent | Research preview (gated) | GA — inspectable child sessions, allowlists, depth caps |

## Quick start

Requires Docker and an API key for any [OpenClaw-supported provider](https://openclaw.ai).

```bash
git clone https://github.com/stainlu/openclaw-managed-agents
cd openclaw-managed-agents

export MOONSHOT_API_KEY=sk-...    # or ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.
docker compose up --build -d
```

Create an agent, open a session, send a message:

```bash
# Create an agent template
AGENT=$(curl -s -X POST http://localhost:8080/v1/agents \
  -H 'Content-Type: application/json' \
  -d '{"model":"moonshot/kimi-k2.5","instructions":"You are a research assistant."}' \
  | jq -r '.agent_id')

# Open a session (container starts booting in the background)
SESSION=$(curl -s -X POST http://localhost:8080/v1/sessions \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"$AGENT\"}" | jq -r '.session_id')

# Send a message — first turn spawns the container; subsequent turns reuse it
curl -s -X POST "http://localhost:8080/v1/sessions/$SESSION/events" \
  -H 'Content-Type: application/json' \
  -d '{"content":"What is 2+2? Reply with just the number."}'

# Poll until done
while [ "$(curl -s http://localhost:8080/v1/sessions/$SESSION | jq -r .status)" = "running" ]; do sleep 2; done

# Read the answer
curl -s "http://localhost:8080/v1/sessions/$SESSION" | jq .output
```

Or use the OpenAI SDK — just change `base_url`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="unused",
    default_headers={"x-openclaw-agent-id": "<your-agent-id>"},
)

r = client.chat.completions.create(
    model="placeholder",
    messages=[{"role": "user", "content": "Summarize the agent platform landscape."}],
)
print(r.choices[0].message.content)
```

## Core concepts

Four primitives, matching Claude Managed Agents' model:

| Concept | What it is | API |
|---|---|---|
| **Agent** | Reusable config: model, instructions, tools, delegation rules. Versioned — updates create immutable history. | `POST/GET/PATCH/DELETE /v1/agents` |
| **Environment** | Container config: packages (pip/apt/npm), networking. Composed with agents at session time. | `POST/GET/DELETE /v1/environments` |
| **Session** | A running agent in an environment. Long-lived, multi-turn, one container per session. | `POST/GET/DELETE /v1/sessions` |
| **Event** | Messages in and out of a session. SSE streaming. Queue-on-busy. | `POST/GET /v1/sessions/:id/events` |

## API reference

The orchestrator is self-documenting — `curl http://localhost:8080/` returns the full endpoint map.

**Agents** (versioned, archivable)

```
POST   /v1/agents                         # { model, instructions, tools?, name?, callableAgents?, maxSubagentDepth? }
GET    /v1/agents                         # list all
GET    /v1/agents/:id                     # get latest version
PATCH  /v1/agents/:id                     # { version, ...fields } — bumps version, 409 on conflict
GET    /v1/agents/:id/versions            # immutable version history
POST   /v1/agents/:id/archive             # soft-delete; blocks new sessions, existing ones continue
DELETE /v1/agents/:id                     # hard-delete with all versions
```

**Environments** (container configuration)

```
POST   /v1/environments                   # { name, packages?: { pip?, apt?, npm? }, networking? }
GET    /v1/environments                   # list all
GET    /v1/environments/:id               # get one
DELETE /v1/environments/:id               # 409 if sessions reference it
```

**Sessions** (the main interaction surface)

```
POST   /v1/sessions                       # { agentId, environmentId? }
GET    /v1/sessions                       # list all
GET    /v1/sessions/:id                   # status, output, rolling tokens, cost_usd
DELETE /v1/sessions/:id                   # tears down container + data
POST   /v1/sessions/:id/events            # { content, model? } — queues if busy, auto-drains
GET    /v1/sessions/:id/events            # full event history
GET    /v1/sessions/:id/events?stream=true  # SSE: catch-up + live tail-follow
POST   /v1/sessions/:id/cancel            # abort in-flight run
```

**OpenAI compatibility**

```
POST   /v1/chat/completions              # OpenAI SDK drop-in (x-openclaw-agent-id header required)
```

## Key features

**Agent versioning.** Every update creates an immutable version. Optimistic concurrency via `version` field on PATCH. List the full history. Archive agents without losing data.

**Environments.** Declare packages (`pip`, `apt`, `npm`) and networking policy per environment. Compose any agent with any environment at session creation. Packages install inside the container before the agent boots.

**Session pool.** One Docker container per session, reused across turns. First turn pays the container startup (~40s); subsequent turns reuse the warm container (~4s). Proactive warm-up starts the container at session-create time, not at first-event time.

**Delegated subagents.** An agent can delegate tasks to other agents via the `openclaw-call-agent` CLI. Children are first-class sessions — fully inspectable through the same API. Allowlists, depth caps, and HMAC-signed tokens enforce who can call whom.

**SSE streaming.** `GET /v1/sessions/:id/events?stream=true` catches up on past events then tail-follows new ones in real time. 15-second heartbeats keep proxies alive.

**Cancel + queue.** Cancel aborts the in-flight run via the WebSocket control plane. Events posted to a busy session queue automatically and drain in order.

**Per-turn cost.** Each session tracks rolling `tokens_in`, `tokens_out`, and `cost_usd` from the provider's own billing data — cache-aware, not a static price sheet.

**OpenAI SDK drop-in.** Point any OpenAI SDK at `http://<host>:8080/v1` with an `x-openclaw-agent-id` header. Sticky sessions via the `user` field.

## Deploy

Two one-command deploy scripts, verified on real infrastructure with measured numbers.

### Hetzner Cloud (from $4/month)

```bash
export HCLOUD_TOKEN=<your-token>          # console.hetzner.cloud → Security → API Tokens
export MOONSHOT_API_KEY=sk-...            # or any provider key
./scripts/deploy-hetzner.sh
```

Measured on CAX11 (2 vCPU / 4 GB ARM, $4/month): 78s cold start, 4s pool reuse, 5-7 concurrent sessions.
[Full guide](./docs/deploying-on-hetzner.md)

### AWS Lightsail (from $12/month)

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export MOONSHOT_API_KEY=sk-...
./scripts/deploy-aws-lightsail.sh
```

Measured on medium_3_0 (2 vCPU / 4 GB, $24/month): 294s cold start, 5s pool reuse, 5-7 concurrent sessions.
[Full guide](./docs/deploying-on-aws-lightsail.md)

### Cost comparison (infrastructure only, no token costs)

| | 1 session 24/7 | 10 sessions 24/7 | 100 sessions 24/7 |
|---|---|---|---|
| **Claude Managed Agents** | $57.60/mo | $576/mo | $5,760/mo |
| **Hetzner CAX11** | $4/mo | $8/mo (2 hosts) | $73/mo (17 hosts) |
| **AWS Lightsail** | $24/mo | $48/mo (2 hosts) | $408/mo (17 hosts) |

## Architecture

```
Developer
   |
   | HTTP API (Hono)
   v
Orchestrator
   |
   |-- AgentStore + EnvironmentStore + SessionStore (SQLite)
   |-- SessionContainerPool (one Docker container per session)
   |-- GatewayWebSocketClient (cancel, model override)
   |-- PiJsonlEventReader (event log, cost, SSE)
   |
   v
OpenClaw containers (one per session)
   - Full agent loop (tool use, multi-turn)
   - Pi SessionManager (append-only JSONL)
   - Session resume from JSONL across container restarts
```

The orchestrator is stateless — all durable state lives in SQLite (agents, environments, sessions) and Pi's JSONL files (events). Pre-built multi-arch images (amd64 + arm64) are published to GHCR on every push to `main`.

## Relationship to OpenClaw

This project uses [OpenClaw](https://github.com/openclaw/openclaw) as an npm dependency, not a fork. All agent execution, tool invocation, session management, and provider integration comes from OpenClaw core. This repo adds the managed layer: the orchestrator, the container lifecycle, the API, and the deploy scripts.

## License

MIT
