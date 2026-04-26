"""Data types for the OpenClaw Managed Agents API."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Agent:
    agent_id: str
    model: str
    tools: List[str]
    instructions: str
    permission_policy: Dict[str, Any]
    version: int
    created_at: int
    updated_at: int
    name: Optional[str] = None
    callable_agents: List[str] = field(default_factory=list)
    max_subagent_depth: int = 0
    mcp_servers: Dict[str, Any] = field(default_factory=dict)
    quota: Optional[Dict[str, Any]] = None
    thinking_level: str = "off"
    channels: Dict[str, Any] = field(default_factory=dict)
    archived_at: Optional[int] = None


@dataclass
class Environment:
    environment_id: str
    name: str
    networking: Dict[str, Any]
    created_at: int
    description: str = ""
    packages: Optional[Dict[str, Any]] = None


@dataclass
class Session:
    session_id: str
    agent_id: str
    status: str
    tokens: Dict[str, int]
    cost_usd: float
    created_at: int
    output: Optional[str] = None
    environment_id: Optional[str] = None
    error: Optional[str] = None
    last_event_at: Optional[int] = None
    turns: int = 0
    boot_ms: Optional[int] = None
    pool_source: Optional[str] = None
    container_id: Optional[str] = None
    container_name: Optional[str] = None
    parent_session_id: Optional[str] = None


@dataclass
class Event:
    event_id: str
    session_id: str
    type: str
    content: str
    created_at: int
    tokens: Optional[Dict[str, int]] = None
    cost_usd: Optional[float] = None
    model: Optional[str] = None
    tool_name: Optional[str] = None
    tool_call_id: Optional[str] = None
    tool_arguments: Optional[Dict[str, Any]] = None
    is_error: Optional[bool] = None
    approval_id: Optional[str] = None


@dataclass
class Vault:
    vault_id: str
    user_id: str
    name: str
    created_at: int
    updated_at: int


@dataclass
class VaultCredential:
    credential_id: str
    vault_id: str
    name: str
    type: str
    match_url: str
    created_at: int
    updated_at: int
    token_endpoint: Optional[str] = None
    client_id: Optional[str] = None
    scopes: Optional[List[str]] = None
    expires_at: Optional[int] = None
