import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AgentRegistry } from "./agents.js";
import { AgentRouter, RouterError } from "./router.js";
import { SessionRegistry } from "./sessions.js";
import { CreateAgentRequestSchema, RunAgentRequestSchema } from "./types.js";
import type { ContainerRuntime } from "../runtime/container.js";

export type ServerDeps = {
  agents: AgentRegistry;
  sessions: SessionRegistry;
  router: AgentRouter;
  runtime: ContainerRuntime;
};

export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---------- Agents ----------

  app.post("/v1/agents", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CreateAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", details: parsed.error.format() }, 400);
    }
    const agent = deps.agents.create(parsed.data);
    return c.json({
      agent_id: agent.agentId,
      model: agent.model,
      tools: agent.tools,
      instructions: agent.instructions,
      name: agent.name,
      created_at: agent.createdAt,
    });
  });

  app.get("/v1/agents/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    const agent = deps.agents.get(agentId);
    if (!agent) {
      return c.json({ error: "agent_not_found" }, 404);
    }
    return c.json({
      agent_id: agent.agentId,
      model: agent.model,
      tools: agent.tools,
      instructions: agent.instructions,
      name: agent.name,
      created_at: agent.createdAt,
    });
  });

  app.delete("/v1/agents/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    const existed = deps.agents.delete(agentId);
    if (!existed) {
      return c.json({ error: "agent_not_found" }, 404);
    }
    return c.json({ deleted: true });
  });

  // ---------- Run ----------

  app.post("/v1/agents/:agentId/run", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = RunAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", details: parsed.error.format() }, 400);
    }
    try {
      const session = await deps.router.run({
        agentId,
        task: parsed.data.task,
        resumeSessionId: parsed.data.sessionId,
      });
      return c.json({
        session_id: session.sessionId,
        agent_id: session.agentId,
        status: session.status,
        started_at: session.startedAt,
      });
    } catch (err) {
      if (err instanceof RouterError && err.code === "agent_not_found") {
        return c.json({ error: "agent_not_found" }, 404);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "internal", message: msg }, 500);
    }
  });

  // ---------- Sessions ----------

  app.get("/v1/sessions/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = deps.sessions.get(sessionId);
    if (!session) {
      return c.json({ error: "session_not_found" }, 404);
    }
    return c.json({
      session_id: session.sessionId,
      agent_id: session.agentId,
      status: session.status,
      task: session.task,
      output: session.output,
      error: session.error,
      tokens: {
        input: session.tokensIn,
        output: session.tokensOut,
      },
      cost_usd: session.costUsd,
      started_at: session.startedAt,
      completed_at: session.completedAt,
    });
  });

  return app;
}

export type ListenOptions = {
  port: number;
};

export async function startServer(deps: ServerDeps, opts: ListenOptions): Promise<void> {
  const app = buildApp(deps);
  serve({ fetch: app.fetch, port: opts.port });
  console.log(`[orchestrator] listening on http://0.0.0.0:${opts.port}`);
}
