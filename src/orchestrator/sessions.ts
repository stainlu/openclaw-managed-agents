import { customAlphabet } from "nanoid";
import type { Session } from "./types.js";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

// Long-lived session store. A session persists across many runs; each run is
// one user.message event followed by one agent.message (or agent.error). The
// store holds session metadata and the running status machine; the event log
// itself lives in EventStore.
//
// Status lifecycle:
//   idle  -> running  (beginRun when a new run starts)
//   running -> idle   (endRunSuccess after a successful completion)
//   running -> failed (endRunFailure after an unrecoverable error)
//   failed -> running (beginRun clears the previous error and tries again)
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();

  create(args: { agentId: string; sessionId?: string }): Session {
    const sessionId = args.sessionId ?? `ses_${nanoid()}`;
    const session: Session = {
      sessionId,
      agentId: args.agentId,
      status: "idle",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      error: null,
      createdAt: Date.now(),
      lastEventAt: null,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  beginRun(sessionId: string): Session | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    s.status = "running";
    s.error = null;
    s.lastEventAt = Date.now();
    return s;
  }

  endRunSuccess(
    sessionId: string,
    usage: { tokensIn: number; tokensOut: number; costUsd: number },
  ): Session | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    s.status = "idle";
    s.tokensIn += usage.tokensIn;
    s.tokensOut += usage.tokensOut;
    s.costUsd += usage.costUsd;
    s.lastEventAt = Date.now();
    return s;
  }

  endRunFailure(sessionId: string, error: string): Session | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    s.status = "failed";
    s.error = error;
    s.lastEventAt = Date.now();
    return s;
  }
}
