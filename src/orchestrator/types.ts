import { z } from "zod";

// ---------- Agent ----------

export const CreateAgentRequestSchema = z.object({
  model: z.string().min(1, "model is required"),
  tools: z.array(z.string()).default([]),
  instructions: z.string().default(""),
  /** Optional stable display name for UI/logging. */
  name: z.string().optional(),
});

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export type AgentConfig = {
  agentId: string;
  model: string;
  tools: string[];
  instructions: string;
  name?: string;
  createdAt: number;
};

// ---------- Run ----------

export const RunAgentRequestSchema = z.object({
  task: z.string().min(1, "task is required"),
  /** Resume an existing session instead of starting a new one. */
  sessionId: z.string().optional(),
});

export type RunAgentRequest = z.infer<typeof RunAgentRequestSchema>;

export type SessionStatus = "pending" | "running" | "completed" | "failed";

export type Session = {
  sessionId: string;
  agentId: string;
  status: SessionStatus;
  task: string;
  output: string | null;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  startedAt: number;
  completedAt: number | null;
};
