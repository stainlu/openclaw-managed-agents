# Changelog

All notable changes to OpenClaw Managed Agents are tracked here.

## 0.1.0 - Public Preview

Initial public-preview release.

- Session-centric API: agents, environments, sessions, events, vaults.
- One OpenClaw container per active session with durable JSONL event history.
- Real SSE event streaming and OpenAI-compatible chat completions adapter.
- Warm pool, active-container cap, idle eviction, and container adoption on restart.
- Permission policies: `always_allow`, `deny`, `always_ask`.
- Subagent delegation via first-class child sessions.
- Limited-networking mode with egress-proxy sidecar.
- Per-session quotas for cost, tokens, and wall duration.
- Queryable audit log and Prometheus metrics.
- Python and TypeScript SDKs.
- GHCR images for orchestrator, agent runtime, egress proxy, and Telegram adapter.
- MIT license.
