from __future__ import annotations

import json
from typing import Any, Callable, Dict

import httpx

from openclaw_managed_agents import OpenClawClient


def _json(request: httpx.Request) -> Dict[str, Any]:
    if not request.content:
        return {}
    return json.loads(request.content.decode("utf-8"))


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> OpenClawClient:
    return OpenClawClient(
        base_url="http://openclaw.test",
        api_token="secret",
        transport=httpx.MockTransport(handler),
    )


def _agent(**overrides: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "agent_id": "agt_123",
        "model": "openai/gpt-5.5",
        "tools": ["exec"],
        "instructions": "Be useful.",
        "permission_policy": {"type": "always_allow"},
        "version": 2,
        "created_at": 10,
        "updated_at": 20,
        "name": "worker",
        "callable_agents": ["agt_child"],
        "max_subagent_depth": 1,
        "mcp_servers": {"github": {"url": "https://api.githubcopilot.com/mcp/"}},
        "quota": {"maxTokensPerSession": 50000},
        "thinking_level": "off",
        "channels": {"telegram": {"enabled": True}},
        "archived_at": None,
    }
    data.update(overrides)
    return data


def _session(**overrides: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "session_id": "ses_123",
        "agent_id": "agt_123",
        "status": "idle",
        "tokens": {"input": 11, "output": 7},
        "cost_usd": 0.001,
        "created_at": 10,
        "output": "done",
        "environment_id": "env_123",
        "error": None,
        "last_event_at": 20,
        "turns": 2,
        "boot_ms": 15000,
        "pool_source": "fresh",
        "container_id": "cid",
        "container_name": "openclaw-agt-test",
        "parent_session_id": None,
    }
    data.update(overrides)
    return data


def _event(**overrides: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "event_id": "evt_123",
        "session_id": "ses_123",
        "type": "agent.message",
        "content": "hello",
        "created_at": 10,
        "tokens": {"input": 11, "output": 7},
        "cost_usd": 0.001,
        "model": "openai/gpt-5.5",
        "tool_name": None,
        "tool_call_id": None,
        "tool_arguments": None,
        "is_error": False,
        "approval_id": None,
    }
    data.update(overrides)
    return data


def test_client_sends_bearer_token() -> None:
    seen: Dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers["authorization"]
        return httpx.Response(200, json={"agents": []})

    with _client(handler) as client:
        assert client.agents.list() == []

    assert seen["authorization"] == "Bearer secret"


def test_agents_resource_round_trips_payloads() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, _json(request)))
        if request.method == "POST" and request.url.path == "/v1/agents":
            assert _json(request) == {
                "model": "openai/gpt-5.5",
                "instructions": "Be useful.",
                "tools": ["exec"],
                "name": "worker",
                "permissionPolicy": {"type": "always_allow"},
                "callableAgents": ["agt_child"],
                "maxSubagentDepth": 1,
                "mcpServers": {"github": {"url": "https://api.githubcopilot.com/mcp/"}},
                "quota": {"maxTokensPerSession": 50000},
                "thinkingLevel": "off",
                "channels": {"telegram": {"enabled": True}},
            }
            return httpx.Response(200, json=_agent())
        if request.method == "GET" and request.url.path == "/v1/agents":
            return httpx.Response(200, json={"agents": [_agent()]})
        if request.method == "GET" and request.url.path == "/v1/agents/agt_123":
            return httpx.Response(200, json=_agent())
        if request.method == "PATCH" and request.url.path == "/v1/agents/agt_123":
            assert _json(request) == {
                "version": 2,
                "model": "deepseek/deepseek-v4-pro",
                "instructions": "Updated.",
                "thinkingLevel": "high",
            }
            return httpx.Response(200, json=_agent(model="deepseek/deepseek-v4-pro"))
        if request.method == "GET" and request.url.path == "/v1/agents/agt_123/versions":
            return httpx.Response(200, json={"versions": [_agent(version=1), _agent()]})
        if request.method == "POST" and request.url.path == "/v1/agents/agt_123/archive":
            return httpx.Response(200, json=_agent(archived_at=30))
        if request.method == "DELETE" and request.url.path == "/v1/agents/agt_123":
            return httpx.Response(204)
        if request.method == "POST" and request.url.path == "/v1/agents/agt_123/warm":
            return httpx.Response(200, json={"ok": True})
        if request.method == "POST" and request.url.path == "/v1/agents/agt_123/run":
            assert _json(request) == {"task": "summarize", "sessionId": "ses_123"}
            return httpx.Response(200, json={"session_id": "ses_123", "output": "done"})
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    with _client(handler) as client:
        created = client.agents.create(
            model="openai/gpt-5.5",
            instructions="Be useful.",
            tools=["exec"],
            name="worker",
            permission_policy={"type": "always_allow"},
            callable_agents=["agt_child"],
            max_subagent_depth=1,
            mcp_servers={"github": {"url": "https://api.githubcopilot.com/mcp/"}},
            quota={"maxTokensPerSession": 50000},
            thinking_level="off",
            channels={"telegram": {"enabled": True}},
        )
        assert created.agent_id == "agt_123"
        assert created.callable_agents == ["agt_child"]
        assert client.agents.list()[0].name == "worker"
        assert client.agents.get("agt_123").model == "openai/gpt-5.5"
        updated = client.agents.update(
            "agt_123",
            version=2,
            model="deepseek/deepseek-v4-pro",
            instructions="Updated.",
            thinking_level="high",
        )
        assert updated.model == "deepseek/deepseek-v4-pro"
        assert [a.version for a in client.agents.list_versions("agt_123")] == [1, 2]
        assert client.agents.archive("agt_123").archived_at == 30
        assert client.agents.warm("agt_123") == {"ok": True}
        assert client.agents.run("agt_123", task="summarize", session_id="ses_123") == {
            "session_id": "ses_123",
            "output": "done",
        }
        client.agents.delete("agt_123")

    assert ("DELETE", "/v1/agents/agt_123", {}) in calls


def test_sessions_resource_and_sse_stream() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/sessions":
            assert _json(request) == {
                "agentId": "agt_123",
                "environmentId": "env_123",
                "vaultId": "vlt_123",
            }
            return httpx.Response(200, json=_session())
        if request.method == "GET" and request.url.path == "/v1/sessions":
            return httpx.Response(200, json={"sessions": [_session()]})
        if request.method == "GET" and request.url.path == "/v1/sessions/ses_123":
            return httpx.Response(200, json=_session())
        if request.method == "POST" and request.url.path == "/v1/sessions/ses_123/events":
            body = _json(request)
            if body.get("type") == "user.tool_confirmation":
                assert body == {
                    "type": "user.tool_confirmation",
                    "toolUseId": "call_123",
                    "result": "deny",
                    "denyMessage": "not allowed",
                }
                return httpx.Response(200, json={"queued": False})
            assert body == {
                "content": "hi",
                "model": "openai/gpt-5.5",
                "thinkingLevel": "off",
            }
            return httpx.Response(202, json={"status": "running", "queued": False})
        if request.method == "POST" and request.url.path == "/v1/sessions/ses_123/cancel":
            return httpx.Response(200, json={"status": "cancelled"})
        if request.method == "POST" and request.url.path == "/v1/sessions/ses_123/compact":
            return httpx.Response(200, json={"status": "queued"})
        if request.method == "GET" and request.url.path == "/v1/sessions/ses_123/logs":
            assert request.url.params["tail"] == "50"
            return httpx.Response(200, text="container logs")
        if request.method == "GET" and request.url.path == "/v1/sessions/ses_123/events":
            if request.url.params.get("stream") == "true":
                payload = json.dumps(_event(content="streamed"))
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    content=(
                        "event: heartbeat\n"
                        "data: {}\n\n"
                        "event: message\n"
                        f"data: {payload}\n\n"
                    ).encode("utf-8"),
                )
            return httpx.Response(200, json={"events": [_event(content="stored")]})
        if request.method == "DELETE" and request.url.path == "/v1/sessions/ses_123":
            return httpx.Response(204)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    with _client(handler) as client:
        created = client.sessions.create(
            agent_id="agt_123",
            environment_id="env_123",
            vault_id="vlt_123",
        )
        assert created.session_id == "ses_123"
        assert created.boot_ms == 15000
        assert client.sessions.list()[0].status == "idle"
        assert client.sessions.get("ses_123").output == "done"
        assert client.sessions.send(
            "ses_123",
            content="hi",
            model="openai/gpt-5.5",
            thinking_level="off",
        ) == {"status": "running", "queued": False}
        assert client.sessions.confirm_tool(
            "ses_123",
            tool_use_id="call_123",
            result="deny",
            deny_message="not allowed",
        ) == {"queued": False}
        assert client.sessions.cancel("ses_123") == {"status": "cancelled"}
        assert client.sessions.compact("ses_123") == {"status": "queued"}
        assert client.sessions.logs("ses_123", tail=50) == "container logs"
        assert client.sessions.events("ses_123")[0].content == "stored"
        assert [event.content for event in client.sessions.stream("ses_123")] == ["streamed"]
        client.sessions.delete("ses_123")


def test_environments_resource() -> None:
    env = {
        "environment_id": "env_123",
        "name": "default",
        "description": "workbench",
        "packages": {"apt": ["git"]},
        "networking": {"type": "limited", "allowedHosts": ["api.github.com"]},
        "created_at": 10,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/environments":
            assert _json(request) == {
                "name": "default",
                "description": "workbench",
                "packages": {"apt": ["git"]},
                "networking": {"type": "limited", "allowedHosts": ["api.github.com"]},
            }
            return httpx.Response(200, json=env)
        if request.method == "GET" and request.url.path == "/v1/environments":
            return httpx.Response(200, json={"environments": [env]})
        if request.method == "GET" and request.url.path == "/v1/environments/env_123":
            return httpx.Response(200, json=env)
        if request.method == "DELETE" and request.url.path == "/v1/environments/env_123":
            return httpx.Response(204)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    with _client(handler) as client:
        created = client.environments.create(
            name="default",
            description="workbench",
            packages={"apt": ["git"]},
            networking={"type": "limited", "allowedHosts": ["api.github.com"]},
        )
        assert created.environment_id == "env_123"
        assert client.environments.list()[0].packages == {"apt": ["git"]}
        assert client.environments.get("env_123").networking["type"] == "limited"
        client.environments.delete("env_123")


def test_vaults_resource() -> None:
    vault = {
        "vault_id": "vlt_123",
        "user_id": "user_123",
        "name": "prod",
        "created_at": 10,
        "updated_at": 20,
    }
    credential = {
        "credential_id": "cred_123",
        "vault_id": "vlt_123",
        "name": "github",
        "type": "static_bearer",
        "match_url": "https://api.githubcopilot.com/mcp/",
        "created_at": 10,
        "updated_at": 20,
    }
    oauth_credential = {
        **credential,
        "credential_id": "cred_oauth",
        "type": "mcp_oauth",
        "token_endpoint": "https://example.com/token",
        "client_id": "client",
        "scopes": ["repo"],
        "expires_at": 123,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/vaults":
            assert _json(request) == {"userId": "user_123", "name": "prod"}
            return httpx.Response(200, json=vault)
        if request.method == "GET" and request.url.path == "/v1/vaults":
            assert request.url.params["user_id"] == "user_123"
            return httpx.Response(200, json={"vaults": [vault]})
        if request.method == "GET" and request.url.path == "/v1/vaults/vlt_123":
            return httpx.Response(200, json=vault)
        if request.method == "POST" and request.url.path == "/v1/vaults/vlt_123/credentials":
            body = _json(request)
            if body["type"] == "static_bearer":
                assert body == {
                    "name": "github",
                    "type": "static_bearer",
                    "matchUrl": "https://api.githubcopilot.com/mcp/",
                    "token": "ghp_secret",
                }
                return httpx.Response(200, json=credential)
            assert body == {
                "name": "oauth",
                "type": "mcp_oauth",
                "matchUrl": "https://api.githubcopilot.com/mcp/",
                "accessToken": "access",
                "refreshToken": "refresh",
                "expiresAt": 123,
                "tokenEndpoint": "https://example.com/token",
                "clientId": "client",
                "clientSecret": "secret",
                "scopes": ["repo"],
            }
            return httpx.Response(200, json=oauth_credential)
        if request.method == "GET" and request.url.path == "/v1/vaults/vlt_123/credentials":
            return httpx.Response(200, json={"credentials": [credential, oauth_credential]})
        if (
            request.method == "DELETE"
            and request.url.path == "/v1/vaults/vlt_123/credentials/cred_123"
        ):
            return httpx.Response(204)
        if request.method == "DELETE" and request.url.path == "/v1/vaults/vlt_123":
            return httpx.Response(204)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    with _client(handler) as client:
        assert client.vaults.create(user_id="user_123", name="prod").vault_id == "vlt_123"
        assert client.vaults.list(user_id="user_123")[0].user_id == "user_123"
        assert client.vaults.get("vlt_123").name == "prod"
        assert client.vaults.add_static_bearer_credential(
            "vlt_123",
            name="github",
            match_url="https://api.githubcopilot.com/mcp/",
            token="ghp_secret",
        ).credential_id == "cred_123"
        assert client.vaults.add_mcp_oauth_credential(
            "vlt_123",
            name="oauth",
            match_url="https://api.githubcopilot.com/mcp/",
            access_token="access",
            refresh_token="refresh",
            expires_at=123,
            token_endpoint="https://example.com/token",
            client_id="client",
            client_secret="secret",
            scopes=["repo"],
        ).type == "mcp_oauth"
        credentials = client.vaults.list_credentials("vlt_123")
        assert [cred.credential_id for cred in credentials] == ["cred_123", "cred_oauth"]
        client.vaults.delete_credential("vlt_123", "cred_123")
        client.vaults.delete("vlt_123")
