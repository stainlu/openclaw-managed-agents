# OpenClaw Managed Runtime

**The open alternative to Claude Managed Agents.** An API-first managed agent runtime built on top of OpenClaw.

> **Status:** currently hosted under `stainlu/` as the initial development location. Will migrate to `openclaw/managed-runtime` once upstream adoption is confirmed. Uses `openclaw` as a dependency, not a fork.

---

## What this is

OpenClaw Managed Runtime is an API-first service that runs agent tasks on demand. A developer sends an HTTP request to create an agent, submits a task, and receives results — with sandboxed tool execution, persistent sessions, and credential isolation, all without managing infrastructure.

It is the open counter to Anthropic's Claude Managed Agents:

| | Claude Managed Agents | OpenClaw Managed Runtime |
|---|---|---|
| Model | Claude only | Any model (Bedrock, Gemini, Qwen, GPT, ...) |
| Cloud | Anthropic-hosted only | Any cloud (AWS, GCP, Azure, Aliyun, Volcengine, self-hosted) |
| Source | Closed | Open source (MIT) |
| Session-hour tax | $0.08/hr | None |
| Data sovereignty | None | Full — your data, your cloud, your control |

## How it works

The runtime is one Docker image plus a thin orchestrator. Cloud providers wrap it under their own brand:

- **AWS OpenClaw** = this runtime + Bedrock default + ECS/Fargate orchestration + AWS Marketplace billing
- **Google OpenClaw** = this runtime + Gemini default + Cloud Run orchestration + GCP Marketplace billing
- **Azure OpenClaw** = this runtime + Azure AI Foundry default + Container Apps orchestration + Azure Marketplace billing
- **Aliyun OpenClaw** = this runtime + Qwen default + ECI orchestration + Aliyun Marketplace billing
- **Volcengine OpenClaw** = this runtime + Doubao default + VKE orchestration + Volcengine Marketplace billing

One codebase, one Docker image, all clouds.

## Architecture

```
Developer
   │ POST /v1/agents         create an agent
   │ POST /v1/agents/:id/run submit a task
   │ GET  /v1/sessions/:id   fetch result
   ▼
Orchestrator (this repo)
   │
   │ spawn()                  route()
   ▼                          ▼
ContainerRuntime         OpenClaw container
 (Docker/ECS/...)         - entrypoint generates openclaw.json
                          - exposes /v1/chat/completions
                          - runs the full agent loop (tool use, multi-turn)
                          - persists session JSONL to mounted volume
```

One OpenClaw container per agent. Each container is effectively single-user, which gives us true isolation for free — the orchestrator creates multi-user semantics externally without touching OpenClaw core.

## API

```
GET    /                       # self-documenting root: version, endpoints, docs link
GET    /healthz                # liveness probe: { ok, version }

POST   /v1/agents              # body: { model, tools, instructions, name? }
                               # → { agent_id, model, tools, instructions, name, created_at }

GET    /v1/agents              # → { agents: [...], count }
GET    /v1/agents/:agentId     # → full agent config
DELETE /v1/agents/:agentId     # → { deleted: true }

POST   /v1/agents/:agentId/run # body: { task, sessionId? }
                               # → { session_id, agent_id, status, started_at }

GET    /v1/sessions/:sessionId # → { session_id, agent_id, status, task, output,
                               #      error, tokens: { input, output }, cost_usd,
                               #      started_at, completed_at }
```

The orchestrator is self-documenting — `curl http://localhost:8080/` returns the full endpoint list, version, and links. You never need this section to discover the API, it's just here as a quick reference.

## Quick start (local Docker)

Requires: Docker, Node 22+, and an API key for at least one provider OpenClaw supports. The default smoke path uses Moonshot Kimi K2.5 (`moonshot/kimi-k2.5`) because it works from any country Moonshot supports without needing a cloud account. Any OpenClaw provider works — just swap the `model` field and export the matching key.

```bash
git clone https://github.com/stainlu/openclaw-managed-runtime
cd openclaw-managed-runtime
pnpm install

# Pick your provider (examples — you only need one).
export MOONSHOT_API_KEY=sk-...      # moonshot/kimi-k2.5 (default)
# export ANTHROPIC_API_KEY=sk-...   # anthropic/claude-sonnet-4-6
# export OPENAI_API_KEY=sk-...      # openai/gpt-5.4
# export GEMINI_API_KEY=...         # google/gemini-2.5-pro
# export AWS_PROFILE=openclaw       # bedrock/anthropic.claude-sonnet-4-6

docker compose up --build
```

Then in another terminal:

```bash
# Create an agent
curl -X POST http://localhost:8080/v1/agents \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "moonshot/kimi-k2.5",
    "tools": [],
    "instructions": "You are a research assistant."
  }'
# → {"agent_id":"agt_abc123"}

# Run a task
curl -X POST http://localhost:8080/v1/agents/agt_abc123/run \
  -H 'Content-Type: application/json' \
  -d '{"task": "Summarize the agent platform landscape as of April 2026."}'
# → {"session_id":"ses_xyz789","status":"running"}

# Fetch the result
curl http://localhost:8080/v1/sessions/ses_xyz789
# → {"status":"completed","output":"...","cost_usd":0.12,"tokens":15420}
```

## Status and roadmap

This is **early development**. See `docs/architecture.md` for the technical design.

**Phase 1 (MVP, current — shipping today):** Docker-based local runtime, provider-agnostic default (ships with Moonshot Kimi K2.5 but swaps cleanly to any OpenClaw provider), in-memory agent + session registries, host-volume session storage, self-documenting API root, end-to-end validated against real inference.

**Phase 2 (next):** ECS/Fargate container backend, S3 session storage, cloud secrets (AWS Secrets Manager), Postgres-backed agent/session registries, deployment guides, per-provider cost accounting.

**Phase 3 (later):** GCP Cloud Run, Azure Container Apps, Aliyun ECI, Volcengine VKE backends. Multi-tenant orchestrator with auth and quotas. Enterprise features (audit logs, policy enforcement, tenant isolation).

## License

MIT. See `LICENSE`.

## Relationship to OpenClaw

This project uses [OpenClaw](https://github.com/openclaw/openclaw) as an npm dependency. It is not a fork. All agent execution, tool invocation, session management, and provider integration comes from OpenClaw core. This repo adds only the managed layer on top: the orchestrator service, the container entrypoint, and the cloud-specific adapters.

When OpenClaw upstream is ready, this project will migrate to `openclaw/managed-runtime` as a sibling repo under the official organization.
