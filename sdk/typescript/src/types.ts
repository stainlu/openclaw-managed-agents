export interface Agent {
  agent_id: string;
  model: string;
  tools: string[];
  instructions: string;
  permission_policy: PermissionPolicy;
  version: number;
  created_at: number;
  updated_at: number;
  name?: string | null;
  callable_agents: string[];
  max_subagent_depth: number;
  mcp_servers: McpServers;
  quota?: Quota | null;
  thinking_level: ThinkingLevel;
  channels: Channels;
  archived_at?: number | null;
}

export type PermissionPolicy =
  | { type: "always_allow" }
  | { type: "deny"; tools: string[] }
  | { type: "always_ask"; tools?: string[] };

export type ThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh";

export interface Quota {
  maxCostUsdPerSession?: number;
  maxTokensPerSession?: number;
  maxWallDurationMs?: number;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string | number | boolean>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export type McpServers = Record<string, McpServerConfig>;

export interface Channels {
  telegram?: { enabled?: boolean };
}

export interface Environment {
  environment_id: string;
  name: string;
  description?: string;
  networking: EnvironmentNetworking;
  created_at: number;
  packages?: EnvironmentPackages | null;
}

export type EnvironmentNetworking =
  | { type: "unrestricted" }
  | {
      type: "limited";
      allowedHosts: string[];
      allowMcpServers?: boolean;
      allowPackageManagers?: boolean;
    };

export interface EnvironmentPackages {
  pip?: string[];
  apt?: string[];
  npm?: string[];
  cargo?: string[];
  gem?: string[];
  go?: string[];
}

export interface Session {
  session_id: string;
  agent_id: string;
  status: "idle" | "starting" | "running" | "failed";
  tokens: { input: number; output: number };
  cost_usd: number;
  created_at: number;
  output?: string | null;
  environment_id?: string | null;
  error?: string | null;
  last_event_at?: number | null;
  turns?: number;
  boot_ms?: number | null;
  pool_source?: "active" | "warm" | "fresh" | "adopted" | string | null;
  container_id?: string | null;
  container_name?: string | null;
  parent_session_id?: string | null;
}

export interface Event {
  event_id: string;
  session_id: string;
  type: string;
  content: string;
  created_at: number;
  tokens?: { input: number; output: number } | null;
  cost_usd?: number | null;
  model?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_arguments?: Record<string, unknown> | null;
  is_error?: boolean | null;
  approval_id?: string | null;
}

export interface SendEventResult {
  session_id: string;
  status: string;
  queued?: boolean;
}

export interface CancelResult {
  session_id: string;
  session_status: Session["status"];
  cancelled: true;
}

export interface CompactResult {
  session_id: string;
  session_status: Session["status"];
  compacted: true;
}

export interface RunAgentResult {
  session_id: string;
  agent_id: string;
  status: Session["status"];
  started_at: number;
}

export interface WarmAgentResult {
  agent_id: string;
  queued: true;
}

export interface Vault {
  vault_id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export type VaultCredential = StaticBearerCredential | McpOAuthCredential;

export interface StaticBearerCredential {
  credential_id: string;
  vault_id: string;
  name: string;
  type: "static_bearer";
  match_url: string;
  created_at: number;
  updated_at: number;
}

export interface McpOAuthCredential {
  credential_id: string;
  vault_id: string;
  name: string;
  type: "mcp_oauth";
  match_url: string;
  token_endpoint: string;
  client_id: string;
  scopes?: string[];
  expires_at: number;
  created_at: number;
  updated_at: number;
}
