"""Session resource methods."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterator, List, Optional

import httpx
from httpx_sse import connect_sse

from ..types import Event, Session


def _parse_session(data: Dict[str, Any]) -> Session:
    return Session(
        session_id=data["session_id"],
        agent_id=data["agent_id"],
        status=data["status"],
        tokens=data.get("tokens", {"input": 0, "output": 0}),
        cost_usd=data.get("cost_usd", 0),
        created_at=data["created_at"],
        output=data.get("output"),
        environment_id=data.get("environment_id"),
        error=data.get("error"),
        last_event_at=data.get("last_event_at"),
    )


def _parse_event(data: Dict[str, Any]) -> Event:
    return Event(
        event_id=data["event_id"],
        session_id=data["session_id"],
        type=data["type"],
        content=data["content"],
        created_at=data["created_at"],
        tokens=data.get("tokens"),
        cost_usd=data.get("cost_usd"),
        model=data.get("model"),
        tool_name=data.get("tool_name"),
        tool_call_id=data.get("tool_call_id"),
        tool_arguments=data.get("tool_arguments"),
        is_error=data.get("is_error"),
        approval_id=data.get("approval_id"),
    )


class Sessions:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def create(
        self,
        *,
        agent_id: str,
        environment_id: Optional[str] = None,
    ) -> Session:
        body: Dict[str, Any] = {"agentId": agent_id}
        if environment_id is not None:
            body["environmentId"] = environment_id
        resp = self._client.post("/v1/sessions", json=body)
        resp.raise_for_status()
        return _parse_session(resp.json())

    def get(self, session_id: str) -> Session:
        resp = self._client.get(f"/v1/sessions/{session_id}")
        resp.raise_for_status()
        return _parse_session(resp.json())

    def list(self) -> List[Session]:
        resp = self._client.get("/v1/sessions")
        resp.raise_for_status()
        return [_parse_session(s) for s in resp.json()["sessions"]]

    def delete(self, session_id: str) -> None:
        resp = self._client.delete(f"/v1/sessions/{session_id}")
        resp.raise_for_status()

    def send(
        self,
        session_id: str,
        *,
        content: str,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Post a user message to a session. Returns session status and queued flag."""
        body: Dict[str, Any] = {"content": content}
        if model is not None:
            body["model"] = model
        resp = self._client.post(f"/v1/sessions/{session_id}/events", json=body)
        resp.raise_for_status()
        return resp.json()

    def confirm_tool(
        self,
        session_id: str,
        *,
        tool_use_id: str,
        result: str,
        deny_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resolve a pending tool confirmation (always_ask policy)."""
        body: Dict[str, Any] = {
            "type": "user.tool_confirmation",
            "toolUseId": tool_use_id,
            "result": result,
        }
        if deny_message is not None:
            body["denyMessage"] = deny_message
        resp = self._client.post(f"/v1/sessions/{session_id}/events", json=body)
        resp.raise_for_status()
        return resp.json()

    def cancel(self, session_id: str) -> Dict[str, Any]:
        """Cancel the in-flight run on a session."""
        resp = self._client.post(f"/v1/sessions/{session_id}/cancel")
        resp.raise_for_status()
        return resp.json()

    def events(self, session_id: str) -> List[Event]:
        """Get the full event history for a session."""
        resp = self._client.get(f"/v1/sessions/{session_id}/events")
        resp.raise_for_status()
        return [_parse_event(e) for e in resp.json()["events"]]

    def stream(self, session_id: str) -> Iterator[Event]:
        """SSE stream of events. Catches up on existing events then tail-follows.

        Yields Event objects. Automatically skips heartbeat events.
        The iterator ends when the server closes the connection (session
        idle for ~30s after the last event).

        Usage::

            for event in client.sessions.stream(session_id):
                if event.type == "agent.message":
                    print(event.content)
        """
        with connect_sse(
            self._client,
            "GET",
            f"/v1/sessions/{session_id}/events",
            params={"stream": "true"},
        ) as sse:
            for server_event in sse.iter_sse():
                if server_event.event == "heartbeat":
                    continue
                try:
                    data = json.loads(server_event.data)
                except (json.JSONDecodeError, TypeError):
                    continue
                yield _parse_event(data)
