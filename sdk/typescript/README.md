# OpenClaw Managed Agents TypeScript SDK

TypeScript/JavaScript client for the [OpenClaw Managed Agents](https://github.com/stainlu/openclaw-managed-agents) API. Zero runtime dependencies — uses native `fetch`.

## Install

```bash
npm install @stainlu/openclaw-managed-agents
```

Requires Node 18.17+ (native `fetch`). Works in browsers and edge runtimes that provide `fetch` + `ReadableStream`.

## Usage

```ts
import { OpenClawClient } from "@stainlu/openclaw-managed-agents";

// `apiToken` matches the orchestrator's OPENCLAW_API_TOKEN.
// Omit it for a local orchestrator without auth.
const client = new OpenClawClient({
  baseUrl: "http://localhost:8080",
  apiToken: process.env.OPENCLAW_API_TOKEN,
});

const agent = await client.agents.create({
  model: "moonshot/kimi-k2.5",
  instructions: "You are a research assistant.",
});

const session = await client.sessions.create({ agentId: agent.agent_id });

await client.sessions.send(session.session_id, { content: "What is 2+2?" });

for await (const event of client.sessions.stream(session.session_id)) {
  if (event.type === "agent.message") {
    console.log(event.content);
  } else if (event.type === "agent.tool_use") {
    console.log(`[tool: ${event.tool_name}]`);
  }
}
```

## Resources

| Resource | Methods |
|---|---|
| `client.agents` | `create`, `get`, `list`, `update`, `archive`, `delete`, `listVersions` |
| `client.environments` | `create`, `get`, `list`, `delete` |
| `client.sessions` | `create`, `get`, `list`, `delete`, `send`, `cancel`, `events`, `stream`, `confirmTool` |

## Error handling

Non-2xx responses throw `OpenClawError` with `.status` and `.body`:

```ts
import { OpenClawClient, OpenClawError } from "@stainlu/openclaw-managed-agents";

try {
  await client.agents.get("agt_missing");
} catch (err) {
  if (err instanceof OpenClawError && err.status === 404) {
    // agent not found
  }
}
```

## Streaming

`sessions.stream()` is an `AsyncGenerator<Event>`. Cancel early with `break`:

```ts
for await (const event of client.sessions.stream(sessionId)) {
  if (event.type === "agent.message") break;
}
```

The server closes the stream after ~30 seconds of idle with no new events.
