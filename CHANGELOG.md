# Changelog

All notable changes to OpenClaw Managed Agents are tracked here.

## 0.2.0 - Beta SDKs and OpenClaw 2026.4.24

- Promote the Python SDK package metadata to Beta.
- Add Python SDK unit coverage for agents, sessions, SSE streaming, environments, and vaults.
- Test the Python SDK across Python 3.9 through 3.13 in CI.
- Mark the Python SDK as typed with `py.typed`.
- Add PyPI package metadata checks to CI and release publishing.
- Upgrade the agent runtime to OpenClaw 2026.4.24.
- Fix generated OpenClaw config to use `thinkingDefault` and explicitly patch later turns back to `off`.
- Add the project demo video to the README.

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
