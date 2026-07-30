"""Run a vault-bound Xquik MCP agent with per-tool confirmation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from openclaw_managed_agents import OpenClawClient

XQUIK_MCP_URL = "https://xquik.com/mcp"
DEFAULT_PROMPT = (
    "Find 5 recent posts about OpenClaw managed agents. "
    "Return each post's author, URL, date, and a short relevance note. "
    "Do not perform any write action."
)
AGENT_INSTRUCTIONS = (
    "Research X/Twitter conversations through Xquik. "
    "Prefer read operations and cite post URLs. "
    "Never expose credentials. "
    "Never perform a write action unless the user explicitly requests it "
    "and the client approves the exact tool call."
)


def require_environment(name: str) -> str:
    """Return one required non-empty environment value."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def compact_arguments(arguments: dict[str, Any] | None) -> str:
    """Render bounded tool arguments for human review."""
    rendered = json.dumps(arguments or {}, ensure_ascii=False, default=str)
    if len(rendered) <= 500:
        return rendered
    return f"{rendered[:497]}..."


def request_decision(tool_name: str | None, arguments: str) -> tuple[str, str]:
    """Ask whether one pending tool call may proceed."""
    print(f"\nTool approval requested: {tool_name or 'unknown'}")
    print(f"Arguments: {arguments}")
    if not sys.stdin.isatty():
        print("Non-interactive input detected. Denying the tool call.")
        return "deny", "Non-interactive runs deny tool calls by default."

    while True:
        answer = input("Allow this call once? [y/N] ").strip().lower()
        if answer in {"y", "yes"}:
            return "allow", ""
        if answer in {"", "n", "no"}:
            return "deny", "The operator denied this tool call."
        print("Enter y or n.")


def stream_result(
    client: OpenClawClient,
    session_id: str,
    prompt: str,
) -> int:
    """Send one task, resolve approvals, and print the final response."""
    prior_event_ids = {event.event_id for event in client.sessions.events(session_id)}
    client.sessions.send(session_id, content=prompt)

    for event in client.sessions.stream(session_id):
        if event.event_id in prior_event_ids:
            continue
        if event.type == "agent.tool_use":
            print(
                f"Tool call: {event.tool_name or 'unknown'} "
                f"{compact_arguments(event.tool_arguments)}"
            )
            continue
        if event.type == "agent.tool_confirmation_request":
            if not event.approval_id:
                raise RuntimeError("Tool approval event omitted approval_id")
            decision, denial = request_decision(
                event.tool_name,
                compact_arguments(event.tool_arguments),
            )
            client.sessions.confirm_tool(
                session_id,
                tool_use_id=event.approval_id,
                result=decision,
                deny_message=denial or None,
            )
            continue
        if event.type == "agent.tool_result":
            outcome = "failed" if event.is_error else "completed"
            print(f"Tool {outcome}: {event.tool_name or 'unknown'}")
            continue
        if event.type == "agent.message":
            print("\nAssistant:")
            print(event.content)
            return 0
        if event.type == "session.status_failed":
            print(f"Session failed: {event.content}", file=sys.stderr)
            return 1

    print("The event stream ended before an agent response.", file=sys.stderr)
    return 1


def parse_args() -> argparse.Namespace:
    """Parse the optional research prompt."""
    parser = argparse.ArgumentParser(
        description="Run a vault-bound Xquik social research agent."
    )
    parser.add_argument("prompt", nargs="?", default=DEFAULT_PROMPT)
    return parser.parse_args()


def main() -> int:
    """Create the vault, agent, and session, then run one task."""
    args = parse_args()
    try:
        xquik_api_key = require_environment("XQUIK_API_KEY")
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1

    base_url = os.environ.get(
        "OPENCLAW_ORCHESTRATOR_URL",
        "http://localhost:8080",
    )
    api_token = os.environ.get("OPENCLAW_API_TOKEN") or None
    model = os.environ.get("OPENCLAW_MODEL", "moonshot/kimi-k2.5")
    user_id = os.environ.get("OPENCLAW_USER_ID", "xquik-example")
    client = OpenClawClient(base_url=base_url, api_token=api_token)

    try:
        vault = client.vaults.create(user_id=user_id, name="xquik")
        client.vaults.add_static_bearer_credential(
            vault.vault_id,
            name="xquik-api",
            match_url=XQUIK_MCP_URL,
            token=xquik_api_key,
        )
        agent = client.agents.create(
            name="xquik-social-research",
            model=model,
            instructions=AGENT_INSTRUCTIONS,
            mcp_servers={"xquik": {"url": XQUIK_MCP_URL}},
            permission_policy={"type": "always_ask"},
        )
        session = client.sessions.create(
            agent_id=agent.agent_id,
            vault_id=vault.vault_id,
        )

        print(f"Agent: {agent.agent_id}")
        print(f"Session: {session.session_id}")
        print("Every MCP tool call requires approval.")
        return stream_result(client, session.session_id, args.prompt)
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
