/**
 * Thin HTTP client for openclaw-managed-agents. Uses fetch. Keeps the
 * three calls the adapter needs: ensure-session, post-event, read-
 * events. Every other API call (agent management, vaults, logs) is out
 * of scope — the adapter is a consumer of the runtime, not its admin.
 */

export type Session = {
  sessionId: string;
  status: "idle" | "running" | "failed";
  output: string | null;
  error: string | null;
};

export type Event = {
  eventId: string;
  sessionId: string;
  type: string;
  content: unknown;
  createdAt: number;
};

export class OrchestratorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string | undefined,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiToken) h.Authorization = `Bearer ${this.apiToken}`;
    return h;
  }

  async health(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/healthz`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`orchestrator health: HTTP ${res.status}`);
    }
  }

  async createSession(agentId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agentId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`orchestrator createSession: HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { session_id: string };
    return data.session_id;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const res = await fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`orchestrator getSession: HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      session_id: string;
      status: "idle" | "running" | "failed";
      output: string | null;
      error: string | null;
    };
    return {
      sessionId: data.session_id,
      status: data.status,
      output: data.output,
      error: data.error,
    };
  }

  async postUserMessage(sessionId: string, content: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "user.message", content }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`orchestrator postEvent: HTTP ${res.status}: ${body}`);
    }
  }

  async listEvents(sessionId: string, afterId?: string, limit = 50): Promise<Event[]> {
    const qs = new URLSearchParams();
    if (afterId) qs.set("after", afterId);
    qs.set("limit", String(limit));
    const res = await fetch(
      `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events?${qs.toString()}`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`orchestrator listEvents: HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      events: Array<{ event_id: string; session_id: string; type: string; content: unknown; created_at: number }>;
    };
    return data.events.map((e) => ({
      eventId: e.event_id,
      sessionId: e.session_id,
      type: e.type,
      content: e.content,
      createdAt: e.created_at,
    }));
  }

  /**
   * Poll the session until status leaves "running" or timeoutMs elapses.
   * Returns the last-seen Session snapshot so the caller can read the
   * final status (idle / failed). On timeout throws.
   */
  async waitForIdle(sessionId: string, timeoutMs: number): Promise<Session> {
    const deadline = Date.now() + timeoutMs;
    let delayMs = 750;
    while (Date.now() < deadline) {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error(`session ${sessionId} disappeared`);
      if (session.status !== "running") return session;
      await sleep(Math.min(delayMs, 3_000));
      delayMs = Math.min(delayMs * 1.5, 3_000);
    }
    throw new Error(`session ${sessionId} did not become idle within ${timeoutMs}ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
