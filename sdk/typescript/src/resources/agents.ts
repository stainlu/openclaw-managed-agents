import type { HttpClient } from "../http.js";
import type {
  Agent,
  Channels,
  McpServers,
  PermissionPolicy,
  Quota,
  RunAgentResult,
  ThinkingLevel,
  WarmAgentResult,
} from "../types.js";

export interface CreateAgentParams {
  model: string;
  instructions?: string;
  tools?: string[];
  name?: string;
  permissionPolicy?: PermissionPolicy;
  callableAgents?: string[];
  maxSubagentDepth?: number;
  mcpServers?: McpServers;
  quota?: Quota;
  thinkingLevel?: ThinkingLevel;
  channels?: Channels;
}

export interface UpdateAgentParams {
  version: number;
  model?: string;
  instructions?: string | null;
  tools?: string[] | null;
  name?: string | null;
  permissionPolicy?: PermissionPolicy;
  callableAgents?: string[] | null;
  maxSubagentDepth?: number;
  mcpServers?: McpServers | null;
  quota?: Quota | null;
  thinkingLevel?: ThinkingLevel;
  channels?: Channels;
}

export interface RunAgentParams {
  task: string;
  sessionId?: string;
}

export class Agents {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateAgentParams): Promise<Agent> {
    const body: Record<string, unknown> = {
      model: params.model,
      instructions: params.instructions ?? "",
    };
    if (params.tools !== undefined) body["tools"] = params.tools;
    if (params.name !== undefined) body["name"] = params.name;
    if (params.permissionPolicy !== undefined) body["permissionPolicy"] = params.permissionPolicy;
    if (params.callableAgents !== undefined) body["callableAgents"] = params.callableAgents;
    if (params.maxSubagentDepth !== undefined) body["maxSubagentDepth"] = params.maxSubagentDepth;
    if (params.mcpServers !== undefined) body["mcpServers"] = params.mcpServers;
    if (params.quota !== undefined) body["quota"] = params.quota;
    if (params.thinkingLevel !== undefined) body["thinkingLevel"] = params.thinkingLevel;
    if (params.channels !== undefined) body["channels"] = params.channels;
    return this.http.request<Agent>("POST", "/v1/agents", body);
  }

  get(agentId: string): Promise<Agent> {
    return this.http.request<Agent>("GET", `/v1/agents/${encodeURIComponent(agentId)}`);
  }

  async list(): Promise<Agent[]> {
    const resp = await this.http.request<{ agents: Agent[] }>("GET", "/v1/agents");
    return resp.agents;
  }

  update(agentId: string, params: UpdateAgentParams): Promise<Agent> {
    const body: Record<string, unknown> = { version: params.version };
    if (params.model !== undefined) body["model"] = params.model;
    if (params.instructions !== undefined) body["instructions"] = params.instructions;
    if (params.tools !== undefined) body["tools"] = params.tools;
    if (params.name !== undefined) body["name"] = params.name;
    if (params.permissionPolicy !== undefined) body["permissionPolicy"] = params.permissionPolicy;
    if (params.callableAgents !== undefined) body["callableAgents"] = params.callableAgents;
    if (params.maxSubagentDepth !== undefined) body["maxSubagentDepth"] = params.maxSubagentDepth;
    if (params.mcpServers !== undefined) body["mcpServers"] = params.mcpServers;
    if (params.quota !== undefined) body["quota"] = params.quota;
    if (params.thinkingLevel !== undefined) body["thinkingLevel"] = params.thinkingLevel;
    if (params.channels !== undefined) body["channels"] = params.channels;
    return this.http.request<Agent>(
      "PATCH",
      `/v1/agents/${encodeURIComponent(agentId)}`,
      body,
    );
  }

  async listVersions(agentId: string): Promise<Agent[]> {
    const resp = await this.http.request<{ versions: Agent[] }>(
      "GET",
      `/v1/agents/${encodeURIComponent(agentId)}/versions`,
    );
    return resp.versions;
  }

  archive(agentId: string): Promise<Agent> {
    return this.http.request<Agent>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/archive`,
    );
  }

  async delete(agentId: string): Promise<void> {
    await this.http.request<void>("DELETE", `/v1/agents/${encodeURIComponent(agentId)}`);
  }

  warm(agentId: string): Promise<WarmAgentResult> {
    return this.http.request<WarmAgentResult>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/warm`,
    );
  }

  run(agentId: string, params: RunAgentParams): Promise<RunAgentResult> {
    const body: Record<string, unknown> = { task: params.task };
    if (params.sessionId !== undefined) body["sessionId"] = params.sessionId;
    return this.http.request<RunAgentResult>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/run`,
      body,
    );
  }
}
