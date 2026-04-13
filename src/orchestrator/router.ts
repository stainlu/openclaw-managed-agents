import type { ContainerRuntime, Mount } from "../runtime/container.js";
import type { AgentRegistry } from "./agents.js";
import type { SessionRegistry } from "./sessions.js";
import type { Session } from "./types.js";

export type RouterConfig = {
  /** Image reference for the OpenClaw agent container. */
  runtimeImage: string;
  /** Host path mounted into each agent container as /workspace for session state. */
  hostStateRoot: string;
  /** Docker network the spawned containers join. */
  network: string;
  /** Gateway port inside the container (must match Dockerfile.runtime). */
  gatewayPort: number;
  /** Environment variables passed through to every spawned container (AWS creds, region, etc.). */
  passthroughEnv: Record<string, string>;
  /** Max time to wait for /readyz (ms). */
  readyTimeoutMs: number;
  /** Max time to wait for the agent task to complete end-to-end (ms). */
  runTimeoutMs: number;
};

export class AgentRouter {
  constructor(
    private readonly agents: AgentRegistry,
    private readonly sessions: SessionRegistry,
    private readonly runtime: ContainerRuntime,
    private readonly cfg: RouterConfig,
  ) {}

  /**
   * Execute a task for an agent. Spawns a dedicated container, waits for it to
   * be ready, proxies the task to its OpenAI-compatible endpoint, captures the
   * result, tears the container down, and returns the completed session.
   */
  async run(args: {
    agentId: string;
    task: string;
    resumeSessionId?: string;
  }): Promise<Session> {
    const agent = this.agents.get(args.agentId);
    if (!agent) {
      throw new RouterError("agent_not_found", `agent ${args.agentId} does not exist`);
    }

    const session = this.sessions.create({
      agentId: args.agentId,
      task: args.task,
      sessionId: args.resumeSessionId,
    });

    // Fire-and-track: the HTTP caller polls GET /v1/sessions/:id for completion.
    this.executeInBackground(session.sessionId, agent, args.task, args.resumeSessionId).catch(
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.sessions.update(session.sessionId, {
          status: "failed",
          error: msg,
          completedAt: Date.now(),
        });
      },
    );

    return { ...session, status: "running" };
  }

  private async executeInBackground(
    sessionId: string,
    agent: { agentId: string; model: string; tools: string[]; instructions: string },
    task: string,
    resumeSessionId: string | undefined,
  ): Promise<void> {
    this.sessions.markStatus(sessionId, "running");

    const hostMount: Mount = {
      hostPath: `${this.cfg.hostStateRoot}/${agent.agentId}`,
      containerPath: "/workspace",
    };

    const env: Record<string, string> = {
      ...this.cfg.passthroughEnv,
      OPENCLAW_AGENT_ID: agent.agentId,
      OPENCLAW_MODEL: agent.model,
      OPENCLAW_TOOLS: agent.tools.join(","),
      OPENCLAW_INSTRUCTIONS: agent.instructions,
      OPENCLAW_STATE_DIR: "/workspace",
      OPENCLAW_GATEWAY_PORT: String(this.cfg.gatewayPort),
      ...(resumeSessionId ? { OPENCLAW_SESSION_ID: resumeSessionId } : {}),
    };

    const container = await this.runtime.spawn({
      image: this.cfg.runtimeImage,
      env,
      mounts: [hostMount],
      containerPort: this.cfg.gatewayPort,
      network: this.cfg.network,
      labels: {
        "agent-id": agent.agentId,
        "session-id": sessionId,
      },
    });

    try {
      await this.runtime.waitForReady(container, this.cfg.readyTimeoutMs);

      const completion = await this.invokeChatCompletions({
        baseUrl: container.baseUrl,
        token: container.token,
        agentId: agent.agentId,
        task,
        sessionKey: sessionId,
      });

      this.sessions.update(sessionId, {
        status: "completed",
        output: completion.output,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
        costUsd: completion.costUsd,
        completedAt: Date.now(),
      });
    } finally {
      await this.runtime.stop(container.id).catch(() => {
        /* best-effort teardown */
      });
    }
  }

  private async invokeChatCompletions(args: {
    baseUrl: string;
    token: string;
    agentId: string;
    task: string;
    sessionKey: string;
  }): Promise<{ output: string; tokensIn: number; tokensOut: number; costUsd: number }> {
    const url = `${args.baseUrl}/v1/chat/completions`;
    // OpenClaw's OpenAI-compatible endpoint validates the `model` field against
    // either the literal "openclaw" or the "openclaw/<agentId>" pattern — it is
    // a routing hint, not the inference model. The actual model used is picked
    // from the selected agent's config (agents.list[].model.primary). See
    // /src/gateway/http-utils.ts:resolveAgentIdFromModel for the pattern.
    const body = {
      model: `openclaw/${args.agentId}`,
      user: args.sessionKey,
      messages: [{ role: "user", content: args.task }],
      stream: false,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
        "x-openclaw-agent-id": args.agentId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.runTimeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new RouterError(
        "chat_completions_failed",
        `/v1/chat/completions returned ${res.status}: ${text}`,
      );
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const output = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    return {
      output,
      tokensIn: usage.prompt_tokens ?? 0,
      tokensOut: usage.completion_tokens ?? 0,
      // Cost accounting is a Phase 2 concern — leave it zero until we wire in
      // per-provider price sheets.
      costUsd: 0,
    };
  }
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class RouterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RouterError";
  }
}
