# Xquik Social Agent

Run a managed X/Twitter research agent through Xquik's hosted MCP server.
The example combines:

- A write-only Managed Agents vault credential.
- A streamable HTTP MCP server on the agent template.
- A vault-bound session with a dedicated container.
- Interactive approval before every MCP tool call.

Use this path for API-managed sessions. Use TweetClaw when OpenClaw runs
directly on your machine.

## Prerequisites

1. Start the orchestrator with a supported model provider key.

   ```bash
   export MOONSHOT_API_KEY=sk-...
   docker compose up -d
   ```

2. Connect an X account and create an API key in the
   [Xquik dashboard](https://xquik.com/dashboard/account?tab=x-accounts).

3. Read the key without adding it to shell history.

   ```bash
   read -rsp "Xquik API key: " XQUIK_API_KEY
   export XQUIK_API_KEY
   printf '\n'
   ```

4. Install the Python SDK and run the example.

   ```bash
   cd examples/xquik-social-agent
   python -m pip install -r requirements.txt
   python xquik_social_agent.py
   ```

Pass a custom task as the first argument:

```bash
python xquik_social_agent.py \
  "Find 5 recent OpenClaw posts and explain why each matters."
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `XQUIK_API_KEY` | required | Xquik key injected into the MCP server |
| `OPENCLAW_ORCHESTRATOR_URL` | `http://localhost:8080` | Managed Agents API URL |
| `OPENCLAW_API_TOKEN` | unset | Orchestrator bearer token |
| `OPENCLAW_MODEL` | `moonshot/kimi-k2.5` | Agent model |
| `OPENCLAW_USER_ID` | `xquik-example` | Vault owner identifier |

The script never prints the Xquik key. The vault API also never returns it.

## How credential injection works

The script creates a static bearer credential whose `matchUrl` is exactly
`https://xquik.com/mcp`. It then creates an agent with that MCP URL and binds
the vault to a new session.

At container spawn, Managed Agents injects:

```text
Authorization: Bearer <XQUIK_API_KEY>
```

The credential applies only to matching MCP server URLs. The agent prompt never
contains the key.

## Approval flow

The agent uses:

```json
{"type": "always_ask"}
```

Omitting `tools` makes Managed Agents pause before every tool call. The example
shows the tool name and arguments, then accepts:

- `y` to allow this call.
- `n` to deny this call.

Non-interactive runs deny tool calls by default. Keep this policy until you
have reviewed the exact MCP tools your workflow needs.

## Local OpenClaw with TweetClaw

For a single local OpenClaw runtime, install TweetClaw instead:

```bash
openclaw plugins install clawhub:@xquik/tweetclaw
openclaw config set plugins.entries.tweetclaw.config.apiKey "$XQUIK_API_KEY"
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
openclaw plugins inspect tweetclaw --runtime --json
```

TweetClaw provides a safe catalog tool and an approval-gated endpoint invoker.
Use the hosted MCP path for Managed Agents sessions.

## Links

- [Xquik MCP guide](https://docs.xquik.com/mcp/overview)
- [Xquik MCP manifest](https://xquik.com/.well-known/mcp.json)
- [TweetClaw](https://github.com/Xquik-dev/tweetclaw)

Xquik is an independent third-party service. Not affiliated with X Corp. "Twitter" and "X" are trademarks of X Corp.
