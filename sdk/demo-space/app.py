"""
OpenClaw Managed Agents — HuggingFace Space demo.

A thin Gradio chat UI in front of an OpenClaw Managed Agents orchestrator.
This Space does not run an orchestrator itself; it points at one you've
deployed (or one the Space operator configured via Space Secrets).

Config resolution (highest priority wins):
  1. Values entered in the UI's Settings accordion (per-user, per-session).
  2. Space Secrets / Variables set by the Space operator.
  3. None — user is prompted to fill in Settings.

Recognized environment variables (set these as Space Secrets or Variables):
  OPENCLAW_URL                    required if you want a pre-configured demo
  OPENCLAW_API_TOKEN              bearer token (secret) if orchestrator enforces auth
  OPENCLAW_DEFAULT_MODEL          e.g. "moonshot/kimi-k2.5"
  OPENCLAW_DEFAULT_INSTRUCTIONS   default system prompt
  OPENCLAW_SPACE_INTRO            markdown shown above the chat
"""

from __future__ import annotations

import os
import threading
from typing import Optional

import gradio as gr
from openclaw_managed_agents import OpenClawClient
from openclaw_managed_agents.types import Event


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


DEFAULT_URL = _env("OPENCLAW_URL")
DEFAULT_TOKEN = _env("OPENCLAW_API_TOKEN")
DEFAULT_MODEL = _env("OPENCLAW_DEFAULT_MODEL", "moonshot/kimi-k2.5")
DEFAULT_INSTRUCTIONS = _env(
    "OPENCLAW_DEFAULT_INSTRUCTIONS",
    "You are a helpful assistant. Be concise, friendly, and show your reasoning when it helps.",
)
INTRO_MARKDOWN = _env("OPENCLAW_SPACE_INTRO") or """\
# OpenClaw Managed Agents — Live Demo

A Gradio UI wired to a real [OpenClaw Managed Agents](https://github.com/stainlu/openclaw-managed-agents) orchestrator.

Every message here opens (or reuses) a durable session. The orchestrator spawns an isolated container, streams events, and tracks cost per session — same API you'd call from your own code.

No orchestrator configured? Paste one in **Settings** below, or deploy your own with:
```bash
./scripts/deploy-hetzner.sh   # or deploy-aws-lightsail.sh / deploy-gcp-compute.sh
```
"""


def _build_client(base_url: str, api_token: str) -> OpenClawClient:
    return OpenClawClient(base_url=base_url, api_token=api_token or None)


# Per-browser-session cache of orchestrator session IDs. Keyed off
# gr.Request.session_hash so each visitor gets their own conversation.
# We cannot cache the OpenClawClient itself — it owns a live httpx pool
# that isn't safe to stash in gr.State, which Gradio may serialize.
_SESSION_CACHE: dict[str, dict] = {}
_SESSION_LOCK = threading.Lock()


def _cache_key(request: Optional[gr.Request]) -> str:
    # session_hash is unique per browser tab; falling back to "anonymous"
    # keeps the app usable when called outside a Gradio request (tests).
    if request is not None and getattr(request, "session_hash", None):
        return request.session_hash
    return "anonymous"


def _ensure_session(
    request: Optional[gr.Request],
    base_url: str,
    api_token: str,
    model: str,
    instructions: str,
) -> tuple[OpenClawClient, str]:
    """Return (client, session_id). Reuse the session unless config changed."""
    config_key = (base_url, api_token, model, instructions)
    cache_key = _cache_key(request)

    client = _build_client(base_url, api_token)

    with _SESSION_LOCK:
        entry = _SESSION_CACHE.get(cache_key)
        if entry and entry["config_key"] == config_key:
            return client, entry["session_id"]

    agent = client.agents.create(model=model, instructions=instructions)
    session = client.sessions.create(agent_id=agent.agent_id)

    with _SESSION_LOCK:
        _SESSION_CACHE[cache_key] = {
            "config_key": config_key,
            "agent_id": agent.agent_id,
            "session_id": session.session_id,
        }
    return client, session.session_id


def _render(ev: Event) -> Optional[str]:
    if ev.type == "agent.message":
        return ev.content or ""
    if ev.type == "agent.tool_use":
        return f"\n\n🔧 _calling `{ev.tool_name}`_"
    if ev.type == "agent.tool_result":
        return f"\n\n{'❌' if ev.is_error else '✅'} _tool finished_"
    return None


def chat(
    message: str,
    history: list,
    base_url: str,
    api_token: str,
    model: str,
    instructions: str,
    request: gr.Request,
):
    base_url = (base_url or DEFAULT_URL).strip()
    api_token = (api_token or DEFAULT_TOKEN).strip()
    model = (model or DEFAULT_MODEL).strip()
    instructions = (instructions or DEFAULT_INSTRUCTIONS).strip()

    if not base_url:
        yield (
            "⚠️ **Orchestrator URL is not set.**\n\n"
            "Open **Settings** below and paste the URL of a running orchestrator, "
            "or if you own this Space set `OPENCLAW_URL` as a Space Secret."
        )
        return

    try:
        client, sid = _ensure_session(request, base_url, api_token, model, instructions)
    except Exception as e:  # noqa: BLE001 — surface any client-side failure to the UI
        yield f"❌ Couldn't open a session: `{e}`"
        return

    try:
        client.sessions.send(sid, content=message)
    except Exception as e:  # noqa: BLE001
        yield f"❌ Couldn't post message: `{e}`"
        return

    buffer = ""
    try:
        for ev in client.sessions.stream(sid):
            chunk = _render(ev)
            if chunk:
                buffer += chunk
                yield buffer
            # The SDK's SSE iterator only ends when the server closes the
            # connection (~30s idle). That stalls the chat. Break early when
            # the session flips back to "idle" after a terminal event.
            if ev.type in ("agent.message", "agent.tool_result"):
                try:
                    if client.sessions.get(sid).status != "running":
                        break
                except Exception:
                    pass
    except Exception as e:  # noqa: BLE001
        yield buffer + f"\n\n⚠️ Stream error: `{e}`"
        return

    if not buffer.strip():
        yield "_(empty response — check the orchestrator logs)_"


with gr.Blocks(title="OpenClaw Managed Agents — Demo") as demo:
    gr.Markdown(INTRO_MARKDOWN)

    with gr.Accordion("Settings", open=not bool(DEFAULT_URL)):
        url_box = gr.Textbox(
            label="Orchestrator URL",
            placeholder="https://your-orchestrator.example.com",
            value=DEFAULT_URL,
        )
        token_box = gr.Textbox(
            label="API token (bearer)",
            placeholder="Leave blank if the orchestrator has auth disabled",
            type="password",
            value="",
        )
        model_box = gr.Textbox(
            label="Model",
            value=DEFAULT_MODEL,
        )
        instructions_box = gr.Textbox(
            label="System prompt",
            value=DEFAULT_INSTRUCTIONS,
            lines=3,
        )
        gr.Markdown("_Changing any of these starts a new session on the next message._")

    gr.Markdown(
        "**Try asking**: "
        "_\"Explain stateful vs stateless agent APIs.\"_ · "
        "_\"Design a retry-with-backoff helper in Python.\"_ · "
        "_\"Write a haiku about container orchestration.\"_"
    )

    gr.ChatInterface(
        fn=chat,
        additional_inputs=[url_box, token_box, model_box, instructions_box],
    )

    gr.Markdown(
        "— Source: [github.com/stainlu/openclaw-managed-agents](https://github.com/stainlu/openclaw-managed-agents)"
    )


if __name__ == "__main__":
    demo.launch(theme=gr.themes.Soft())
