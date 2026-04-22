---
title: OpenClaw Managed Agents Demo
emoji: 🦀
colorFrom: indigo
colorTo: pink
sdk: gradio
app_file: app.py
pinned: false
license: mit
short_description: Live chat demo for OpenClaw Managed Agents.
tags:
  - agents
  - orchestration
  - openclaw
  - managed-agents
  - gradio
---

# OpenClaw Managed Agents — HuggingFace Space demo

A Gradio chat UI that talks to a real [OpenClaw Managed Agents](https://github.com/stainlu/openclaw-managed-agents) orchestrator. The Space itself only runs the UI; every message opens or reuses a durable session on the orchestrator you point it at.

## For visitors

Open the **Settings** accordion, paste:
- your orchestrator URL (e.g. `https://my-orch.example.com`),
- optionally its API token,
- a model and system prompt,

and start chatting. Changing any setting starts a new session on the next message.

Don't have an orchestrator yet? Deploy one in a minute:

```bash
git clone https://github.com/stainlu/openclaw-managed-agents
cd openclaw-managed-agents
./scripts/deploy-hetzner.sh       # or deploy-aws-lightsail.sh / deploy-gcp-compute.sh
```

## For the Space operator — publishing this to HuggingFace

### 1) Create the Space

The easiest path is the CLI:

```bash
pip install -U huggingface_hub
hf auth login                    # paste a token with write access
hf repo create openclaw-managed-agents-demo --repo-type space --space-sdk gradio
```

Alternatively, click **Create new Space** on huggingface.co, pick **Gradio**, name it, and skip the template.

### 2) Upload the files

From the repo root:

```bash
hf upload <your-username>/openclaw-managed-agents-demo sdk/demo-space . --repo-type space
```

Every push rebuilds the Space automatically. Within ~1 minute the app is live at `https://huggingface.co/spaces/<your-username>/openclaw-managed-agents-demo`.

### 3) Configure defaults (optional)

In the Space's **Settings** tab, add these under **Variables and secrets**. With these set, visitors land on a working chat without filling anything in.

| Name | Kind | Purpose |
| --- | --- | --- |
| `OPENCLAW_URL` | Variable | Default orchestrator URL visitors connect to. |
| `OPENCLAW_API_TOKEN` | Secret | Bearer token if your orchestrator has auth enabled. |
| `OPENCLAW_DEFAULT_MODEL` | Variable | Default model slug, e.g. `moonshot/kimi-k2.5`. |
| `OPENCLAW_DEFAULT_INSTRUCTIONS` | Variable | Default system prompt. |
| `OPENCLAW_SPACE_INTRO` | Variable | Markdown shown above the chat (overrides the built-in copy). |

The token is read server-side only — it's never sent to the browser.

### 4) What the free tier gets you

- CPU Basic (2 vCPU, 16 GB RAM) — plenty, since the Space only does HTTP.
- The Space sleeps after inactivity on free hardware; the first message after a nap takes a few seconds to wake.
- Outbound network is permitted on ports 80, 443, 8080 — your orchestrator needs to be reachable on one of those.

### 5) Cost & abuse considerations

- Every message routes through **your** orchestrator, which holds **your** provider keys. A public demo with a shared key is effectively public spending.
- Mitigate by: rate-limiting the orchestrator (`OPENCLAW_RATE_LIMIT_RPM`), using a cheap default model, or leaving `OPENCLAW_URL` unset so each visitor must bring their own orchestrator.

## How it works

- `app.py` — Gradio `ChatInterface` that calls the Python SDK.
- `requirements.txt` — installs the SDK directly from GitHub (swap to PyPI once published).
- Session reuse: `gr.State` carries the session/agent IDs per Gradio tab; a new session is created only when settings change.
- The SDK's SSE iterator waits ~30 s for the server to close after a turn. To avoid stalling the chat, we poll `session.status` after each terminal event and break as soon as it flips back to `idle`.

## License

MIT.
