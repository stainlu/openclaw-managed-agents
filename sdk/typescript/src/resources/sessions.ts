import type { HttpClient } from "../http.js";
import { parseSse } from "../sse.js";
import type { CancelResult, Event, SendEventResult, Session } from "../types.js";

export interface CreateSessionParams {
  agentId: string;
  environmentId?: string;
}

export interface SendParams {
  content: string;
  model?: string;
}

export interface ConfirmToolParams {
  toolUseId: string;
  result: "allow" | "deny";
  denyMessage?: string;
}

export class Sessions {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateSessionParams): Promise<Session> {
    const body: Record<string, unknown> = { agentId: params.agentId };
    if (params.environmentId !== undefined) body["environmentId"] = params.environmentId;
    return this.http.request<Session>("POST", "/v1/sessions", body);
  }

  get(sessionId: string): Promise<Session> {
    return this.http.request<Session>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  async list(): Promise<Session[]> {
    const resp = await this.http.request<{ sessions: Session[] }>("GET", "/v1/sessions");
    return resp.sessions;
  }

  async delete(sessionId: string): Promise<void> {
    await this.http.request<void>(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  send(sessionId: string, params: SendParams): Promise<SendEventResult> {
    const body: Record<string, unknown> = { content: params.content };
    if (params.model !== undefined) body["model"] = params.model;
    return this.http.request<SendEventResult>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/events`,
      body,
    );
  }

  confirmTool(sessionId: string, params: ConfirmToolParams): Promise<SendEventResult> {
    const body: Record<string, unknown> = {
      type: "user.tool_confirmation",
      toolUseId: params.toolUseId,
      result: params.result,
    };
    if (params.denyMessage !== undefined) body["denyMessage"] = params.denyMessage;
    return this.http.request<SendEventResult>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/events`,
      body,
    );
  }

  cancel(sessionId: string): Promise<CancelResult> {
    return this.http.request<CancelResult>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
    );
  }

  async events(sessionId: string): Promise<Event[]> {
    const resp = await this.http.request<{ events: Event[] }>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    return resp.events;
  }

  /**
   * SSE stream of events. Catches up on existing events, then tail-follows.
   * Skips heartbeats. The iterator ends when the server closes the connection
   * (session has been idle for ~30s with no new events).
   *
   * Example:
   * ```ts
   * for await (const event of client.sessions.stream(sessionId)) {
   *   if (event.type === "agent.message") console.log(event.content);
   * }
   * ```
   */
  async *stream(sessionId: string): AsyncGenerator<Event> {
    const resp = await this.http.streamRequest(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events?stream=true`,
    );
    for await (const sse of parseSse(resp)) {
      if (sse.event === "heartbeat") continue;
      if (sse.data.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(sse.data);
      } catch {
        continue;
      }
      yield parsed as Event;
    }
  }
}
