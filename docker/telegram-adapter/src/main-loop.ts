/**
 * Telegram long-poll loop → openclaw session dispatcher.
 *
 * For each inbound Telegram message:
 *   1. Map chat_id → session_id (creating a session on first contact).
 *   2. Show "typing…" indicator to the user.
 *   3. POST the message text as a user.message event.
 *   4. Poll the session until it flips to idle (or failed, or times out).
 *   5. Read the events after the user.message timestamp; send the last
 *      agent.message content back to the user. If the session failed,
 *      surface the error instead.
 *
 * Design choices:
 *   - The loop processes inbound messages SEQUENTIALLY per chat but
 *     CONCURRENTLY across chats. Two users chatting simultaneously don't
 *     block each other. One user sending two messages in a row queues
 *     server-side via the orchestrator's session event queue.
 *   - We use the explicit getUpdates "offset" mechanism: once a batch
 *     is dispatched, the next poll's offset = max(update_id)+1, so
 *     Telegram flushes them permanently. Crash recovery is graceful —
 *     a crashed adapter will replay the last batch from Telegram on
 *     restart, but only once.
 */

import type { Config } from "./config.js";
import type { OrchestratorClient, Event } from "./orchestrator.js";
import type { ChatStorage } from "./storage.js";
import type { TelegramClient, TelegramMessage } from "./telegram.js";

export class MainLoop {
  private stopping = false;
  private readonly inflightByChat = new Map<number, Promise<void>>();
  private nextOffset: number | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly telegram: TelegramClient,
    private readonly orchestrator: OrchestratorClient,
    private readonly storage: ChatStorage,
  ) {}

  async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const updates = await this.telegram.getUpdates({
          offset: this.nextOffset,
          timeout: this.cfg.pollTimeoutSeconds,
        });
        for (const u of updates) {
          this.nextOffset = u.update_id + 1;
          if (!u.message) continue;
          this.dispatch(u.message);
        }
      } catch (err) {
        if (this.stopping) break;
        console.error("[telegram-adapter] poll error:", err instanceof Error ? err.message : err);
        // Back off briefly before retrying so we don't hammer Telegram
        // if the token is revoked or the network is down.
        await sleep(5_000);
      }
    }
  }

  stop(): void {
    this.stopping = true;
  }

  /**
   * Fire-and-forget per-chat. A second message from the same chat
   * queues behind the first by chaining off the existing promise. The
   * orchestrator handles server-side queuing on a running session, so
   * we don't need to strictly serialize at the adapter layer — but
   * chaining gives us a cleaner single-agent-reply-per-user-turn
   * experience.
   */
  private dispatch(msg: TelegramMessage): void {
    if (!msg.text || msg.text.trim() === "") return;
    const prev = this.inflightByChat.get(msg.chat.id) ?? Promise.resolve();
    const next = prev
      .catch(() => {
        /* previous turn's failure is that turn's problem, not this one's */
      })
      .then(() => this.handleMessage(msg));
    this.inflightByChat.set(msg.chat.id, next);
    // Clean up after completion so the map doesn't grow forever.
    next.finally(() => {
      if (this.inflightByChat.get(msg.chat.id) === next) {
        this.inflightByChat.delete(msg.chat.id);
      }
    });
  }

  private async handleMessage(msg: TelegramMessage): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text!;
    const label = `[chat=${chatId}]`;

    // Drop stale messages on first boot — if the bot was down for an
    // hour, the last thing we want is to blast 200 users with replies
    // to "hi" they sent yesterday.
    const ageSeconds = (Date.now() / 1000) - msg.date;
    if (ageSeconds > this.cfg.maxUpdateAgeSeconds) {
      console.log(`${label} dropping update age=${Math.round(ageSeconds)}s (> maxUpdateAgeSeconds)`);
      return;
    }

    // Ensure we have a session for this chat. Deliberately create
    // LAZILY on first contact — creating a session per Telegram chat
    // at adapter startup would spawn N containers for N known chats.
    let sessionId = this.storage.getSessionId(chatId);
    if (!sessionId) {
      try {
        sessionId = await this.orchestrator.createSession(this.cfg.agentId);
        await this.storage.setSessionId(chatId, sessionId);
        console.log(`${label} new session: ${sessionId}`);
      } catch (err) {
        console.error(`${label} createSession failed:`, err);
        await this.telegram.sendMessage(
          chatId,
          "Sorry — I couldn't start a conversation with the agent. Check the adapter logs.",
        );
        return;
      }
    }

    await this.telegram.sendChatAction(chatId, "typing");

    // Remember the latest event cursor BEFORE we post so we know where
    // "this turn" starts in the event stream.
    let cursor: string | undefined;
    try {
      const events = await this.orchestrator.listEvents(sessionId, undefined, 1);
      cursor = events[events.length - 1]?.eventId;
    } catch {
      /* best-effort — if the cursor can't be established we'll just
         read all events on the backhaul side and filter */
    }

    try {
      await this.orchestrator.postUserMessage(sessionId, text);
    } catch (err) {
      console.error(`${label} postEvent failed:`, err);
      await this.telegram.sendMessage(
        chatId,
        "Sorry — I couldn't forward your message. Check the adapter logs.",
      );
      return;
    }

    // Keep the typing indicator warm during long turns — it auto-expires
    // in Telegram after ~5s.
    const typingHeartbeat = setInterval(() => {
      void this.telegram.sendChatAction(chatId, "typing");
    }, 4_500);

    try {
      const final = await this.orchestrator.waitForIdle(sessionId, this.cfg.turnTimeoutMs);
      if (final.status === "failed") {
        await this.telegram.sendMessage(
          chatId,
          `The agent encountered an error: ${final.error ?? "(no detail)"}`,
        );
        return;
      }
      // Read events appended during this turn and take the last
      // agent.message content as the reply. Ignoring tool_use /
      // tool_result / thinking in v1 — those are visible in the
      // portal's trace view, and Telegram is the wrong medium for
      // structured tool traces.
      const fresh = await this.orchestrator.listEvents(sessionId, cursor, 100);
      const reply = lastAgentMessage(fresh);
      await this.storage.touch(chatId);
      if (reply) {
        await this.telegram.sendMessage(chatId, reply);
      } else {
        await this.telegram.sendMessage(
          chatId,
          "(The agent finished but didn't produce a visible reply. Check the portal for details.)",
        );
      }
    } catch (err) {
      console.error(`${label} turn failed:`, err);
      await this.telegram.sendMessage(
        chatId,
        "The agent didn't reply in time. Try again in a moment.",
      );
    } finally {
      clearInterval(typingHeartbeat);
    }
  }
}

function lastAgentMessage(events: Event[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== "agent.message") continue;
    const c = e.content;
    if (typeof c === "string" && c.trim() !== "") return c;
    if (Array.isArray(c)) {
      const joined = c
        .map((p) => (typeof p === "string" ? p : (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : "")))
        .join("");
      if (joined.trim() !== "") return joined;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
