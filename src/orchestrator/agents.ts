import { customAlphabet } from "nanoid";
import type { AgentConfig, CreateAgentRequest } from "./types.js";

// Short, URL-safe, human-recognizable IDs: "agt_" + 12 chars.
const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

export class AgentRegistry {
  private readonly agents = new Map<string, AgentConfig>();

  create(req: CreateAgentRequest): AgentConfig {
    const agentId = `agt_${nanoid()}`;
    const config: AgentConfig = {
      agentId,
      model: req.model,
      tools: req.tools,
      instructions: req.instructions,
      name: req.name,
      createdAt: Date.now(),
    };
    this.agents.set(agentId, config);
    return config;
  }

  get(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  delete(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  list(): AgentConfig[] {
    return Array.from(this.agents.values());
  }
}
