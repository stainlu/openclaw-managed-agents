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
  archived_at?: number | null;
}

export type PermissionPolicy =
  | { type: "always_allow" }
  | { type: "deny"; tools: string[] }
  | { type: "always_ask"; tools: string[] };

export interface Environment {
  environment_id: string;
  name: string;
  networking: EnvironmentNetworking;
  created_at: number;
  packages?: EnvironmentPackages | null;
}

export type EnvironmentNetworking =
  | { type: "unrestricted" }
  | { type: "limited"; allowedHosts: string[] };

export interface EnvironmentPackages {
  pip?: string[];
  apt?: string[];
  npm?: string[];
}

export interface Session {
  session_id: string;
  agent_id: string;
  status: "idle" | "running" | "failed";
  tokens: { input: number; output: number };
  cost_usd: number;
  created_at: number;
  output?: string | null;
  environment_id?: string | null;
  error?: string | null;
  last_event_at?: number | null;
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
  status: "cancelled" | "idle" | "failed";
}
