import { HttpClient } from "./http.js";
import { Agents } from "./resources/agents.js";
import { Environments } from "./resources/environments.js";
import { Sessions } from "./resources/sessions.js";
import { Vaults } from "./resources/vaults.js";

export { OpenClawError } from "./http.js";
export * from "./types.js";
export type { CreateAgentParams, RunAgentParams, UpdateAgentParams } from "./resources/agents.js";
export type { CreateEnvironmentParams } from "./resources/environments.js";
export type {
  CreateSessionParams,
  SendParams,
  ConfirmToolParams,
} from "./resources/sessions.js";
export type {
  AddCredentialParams,
  AddMcpOAuthCredentialParams,
  AddStaticBearerCredentialParams,
  CreateVaultParams,
} from "./resources/vaults.js";

export interface OpenClawClientConfig {
  /** Orchestrator URL (e.g. `http://localhost:8080`). */
  baseUrl?: string;
  /**
   * Bearer token matching the orchestrator's `OPENCLAW_API_TOKEN`.
   * Sent as `Authorization: Bearer <token>` on every request.
   * Omit for a local orchestrator without auth.
   */
  apiToken?: string;
  /**
   * Request timeout in ms. Default 600000 (10 min) to match the
   * orchestrator's chat.completions poll cap. SSE streams do not time out.
   */
  timeoutMs?: number;
  /** Override the fetch implementation (defaults to global `fetch`). */
  fetch?: typeof fetch;
}

/**
 * Client for the OpenClaw Managed Agents API.
 *
 * ```ts
 * import { OpenClawClient } from "@stainlu/openclaw-managed-agents";
 *
 * const client = new OpenClawClient({ baseUrl: "http://localhost:8080" });
 * const agent = await client.agents.create({
 *   model: "moonshot/kimi-k2.5",
 *   instructions: "You are helpful.",
 * });
 * const session = await client.sessions.create({ agentId: agent.agent_id });
 * await client.sessions.send(session.session_id, { content: "What is 2+2?" });
 * for await (const event of client.sessions.stream(session.session_id)) {
 *   if (event.type === "agent.message") console.log(event.content);
 * }
 * ```
 */
export class OpenClawClient {
  readonly agents: Agents;
  readonly environments: Environments;
  readonly sessions: Sessions;
  readonly vaults: Vaults;

  constructor(config: OpenClawClientConfig = {}) {
    const http = new HttpClient({
      baseUrl: config.baseUrl ?? "http://localhost:8080",
      apiToken: config.apiToken,
      timeoutMs: config.timeoutMs ?? 600_000,
      fetch: config.fetch,
    });
    this.agents = new Agents(http);
    this.environments = new Environments(http);
    this.sessions = new Sessions(http);
    this.vaults = new Vaults(http);
  }
}
