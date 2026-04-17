import type { HttpClient } from "../http.js";
import type { Agent, PermissionPolicy } from "../types.js";

export interface CreateAgentParams {
  model: string;
  instructions?: string;
  tools?: string[];
  name?: string;
  permissionPolicy?: PermissionPolicy;
  callableAgents?: string[];
  maxSubagentDepth?: number;
}

export interface UpdateAgentParams {
  version: number;
  model?: string;
  instructions?: string;
  tools?: string[];
  name?: string | null;
  permissionPolicy?: PermissionPolicy;
  callableAgents?: string[];
  maxSubagentDepth?: number;
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
}
