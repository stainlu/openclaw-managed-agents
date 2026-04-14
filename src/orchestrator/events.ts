import { customAlphabet } from "nanoid";
import type { Event, EventType } from "./types.js";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

// In-memory event log, keyed by session. Append-only within a session.
// This is the temporary Item 2 backing store — Item 5 replaces it by reading
// OpenClaw's JSONL session file from the host mount directly, so the API
// shape here is intentionally narrow: append, list, latest-of-type. Anything
// richer should wait until the JSONL parser lands to avoid double work.
export class EventStore {
  private readonly bySession = new Map<string, Event[]>();

  append(args: {
    sessionId: string;
    type: EventType;
    content: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    model?: string;
  }): Event {
    const event: Event = {
      eventId: `evt_${nanoid()}`,
      sessionId: args.sessionId,
      type: args.type,
      content: args.content,
      createdAt: Date.now(),
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      costUsd: args.costUsd,
      model: args.model,
    };
    const existing = this.bySession.get(args.sessionId) ?? [];
    existing.push(event);
    this.bySession.set(args.sessionId, existing);
    return event;
  }

  listBySession(sessionId: string): Event[] {
    return this.bySession.get(sessionId) ?? [];
  }

  // Latest agent.message in the session, scanning from the tail so the common
  // case ("most recent turn's reply") is O(1) in practice. Returns undefined
  // if the session has no agent messages yet.
  latestAgentMessage(sessionId: string): Event | undefined {
    const events = this.bySession.get(sessionId);
    if (!events) return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e && e.type === "agent.message") return e;
    }
    return undefined;
  }

  deleteBySession(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
