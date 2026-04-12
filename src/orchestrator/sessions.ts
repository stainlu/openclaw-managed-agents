import { customAlphabet } from "nanoid";
import type { Session, SessionStatus } from "./types.js";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();

  create(args: { agentId: string; task: string; sessionId?: string }): Session {
    const sessionId = args.sessionId ?? `ses_${nanoid()}`;
    const session: Session = {
      sessionId,
      agentId: args.agentId,
      status: "pending",
      task: args.task,
      output: null,
      error: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      startedAt: Date.now(),
      completedAt: null,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, patch: Partial<Session>): Session | undefined {
    const existing = this.sessions.get(sessionId);
    if (!existing) return undefined;
    const next = { ...existing, ...patch };
    this.sessions.set(sessionId, next);
    return next;
  }

  markStatus(sessionId: string, status: SessionStatus): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    existing.status = status;
    if (status === "completed" || status === "failed") {
      existing.completedAt = Date.now();
    }
  }
}
