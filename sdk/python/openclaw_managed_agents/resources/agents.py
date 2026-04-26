"""Agent resource methods."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from ..types import Agent


def _parse_agent(data: Dict[str, Any]) -> Agent:
    return Agent(
        agent_id=data["agent_id"],
        model=data["model"],
        tools=data.get("tools", []),
        instructions=data.get("instructions", ""),
        permission_policy=data.get("permission_policy", {"type": "always_allow"}),
        version=data["version"],
        created_at=data["created_at"],
        updated_at=data["updated_at"],
        name=data.get("name"),
        callable_agents=data.get("callable_agents", []),
        max_subagent_depth=data.get("max_subagent_depth", 0),
        mcp_servers=data.get("mcp_servers", {}),
        quota=data.get("quota"),
        thinking_level=data.get("thinking_level", "off"),
        channels=data.get("channels", {}),
        archived_at=data.get("archived_at"),
    )


class Agents:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def create(
        self,
        *,
        model: str,
        instructions: str = "",
        tools: Optional[List[str]] = None,
        name: Optional[str] = None,
        permission_policy: Optional[Dict[str, Any]] = None,
        callable_agents: Optional[List[str]] = None,
        max_subagent_depth: Optional[int] = None,
        mcp_servers: Optional[Dict[str, Any]] = None,
        quota: Optional[Dict[str, Any]] = None,
        thinking_level: Optional[str] = None,
        channels: Optional[Dict[str, Any]] = None,
    ) -> Agent:
        body: Dict[str, Any] = {"model": model, "instructions": instructions}
        if tools is not None:
            body["tools"] = tools
        if name is not None:
            body["name"] = name
        if permission_policy is not None:
            body["permissionPolicy"] = permission_policy
        if callable_agents is not None:
            body["callableAgents"] = callable_agents
        if max_subagent_depth is not None:
            body["maxSubagentDepth"] = max_subagent_depth
        if mcp_servers is not None:
            body["mcpServers"] = mcp_servers
        if quota is not None:
            body["quota"] = quota
        if thinking_level is not None:
            body["thinkingLevel"] = thinking_level
        if channels is not None:
            body["channels"] = channels
        resp = self._client.post("/v1/agents", json=body)
        resp.raise_for_status()
        return _parse_agent(resp.json())

    def get(self, agent_id: str) -> Agent:
        resp = self._client.get(f"/v1/agents/{agent_id}")
        resp.raise_for_status()
        return _parse_agent(resp.json())

    def list(self) -> List[Agent]:
        resp = self._client.get("/v1/agents")
        resp.raise_for_status()
        return [_parse_agent(a) for a in resp.json()["agents"]]

    def update(
        self,
        agent_id: str,
        *,
        version: int,
        model: Optional[str] = None,
        instructions: Optional[str] = None,
        tools: Optional[List[str]] = None,
        name: Optional[str] = None,
        permission_policy: Optional[Dict[str, Any]] = None,
        callable_agents: Optional[List[str]] = None,
        max_subagent_depth: Optional[int] = None,
        mcp_servers: Optional[Dict[str, Any]] = None,
        quota: Optional[Dict[str, Any]] = None,
        thinking_level: Optional[str] = None,
        channels: Optional[Dict[str, Any]] = None,
    ) -> Agent:
        body: Dict[str, Any] = {"version": version}
        if model is not None:
            body["model"] = model
        if instructions is not None:
            body["instructions"] = instructions
        if tools is not None:
            body["tools"] = tools
        if name is not None:
            body["name"] = name
        if permission_policy is not None:
            body["permissionPolicy"] = permission_policy
        if callable_agents is not None:
            body["callableAgents"] = callable_agents
        if max_subagent_depth is not None:
            body["maxSubagentDepth"] = max_subagent_depth
        if mcp_servers is not None:
            body["mcpServers"] = mcp_servers
        if quota is not None:
            body["quota"] = quota
        if thinking_level is not None:
            body["thinkingLevel"] = thinking_level
        if channels is not None:
            body["channels"] = channels
        resp = self._client.patch(f"/v1/agents/{agent_id}", json=body)
        resp.raise_for_status()
        return _parse_agent(resp.json())

    def list_versions(self, agent_id: str) -> List[Agent]:
        resp = self._client.get(f"/v1/agents/{agent_id}/versions")
        resp.raise_for_status()
        return [_parse_agent(v) for v in resp.json()["versions"]]

    def archive(self, agent_id: str) -> Agent:
        resp = self._client.post(f"/v1/agents/{agent_id}/archive")
        resp.raise_for_status()
        return _parse_agent(resp.json())

    def delete(self, agent_id: str) -> None:
        resp = self._client.delete(f"/v1/agents/{agent_id}")
        resp.raise_for_status()

    def warm(self, agent_id: str) -> Dict[str, Any]:
        resp = self._client.post(f"/v1/agents/{agent_id}/warm")
        resp.raise_for_status()
        return resp.json()

    def run(
        self,
        agent_id: str,
        *,
        task: str,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"task": task}
        if session_id is not None:
            body["sessionId"] = session_id
        resp = self._client.post(f"/v1/agents/{agent_id}/run", json=body)
        resp.raise_for_status()
        return resp.json()
