/**
 * Thin fetch-based wrapper over Telegram's Bot API. No external npm
 * deps — keeps the container image ~40 MB instead of ~250 MB with
 * grammy/node-telegram-bot-api.
 *
 * Only the endpoints the adapter actually uses are implemented:
 *   - getUpdates (long-polling for inbound messages)
 *   - sendMessage (reply text)
 *   - sendChatAction ("typing" indicator while the agent thinks)
 *   - deleteWebhook (called once at startup — long-poll mode is
 *     mutually exclusive with webhooks per Telegram; ensure no webhook
 *     is live or getUpdates will 409 forever)
 *
 * See https://core.telegram.org/bots/api for the full reference.
 */

const BASE = "https://api.telegram.org";

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string; username?: string };
  from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
  text?: string;
};

type ApiResult<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string };

// Telegram caps message text at 4096 characters. We split anything
// longer into chunks; the boundary tries to land on a newline or space
// to avoid cutting a word.
const TG_MAX_MESSAGE_LENGTH = 4000;

export class TelegramClient {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      // Long-poll requests can take up to pollTimeoutSeconds + a few seconds
      // of network slack — the caller picks the AbortSignal for those. For
      // non-polling calls, a 30s bound keeps us from hanging forever on a
      // flaky network.
      signal: params.timeout ? undefined : AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Telegram ${method}: HTTP ${res.status}`);
    }
    const body = (await res.json()) as ApiResult<T>;
    if (!body.ok) {
      throw new Error(`Telegram ${method}: ${body.error_code} ${body.description}`);
    }
    return body.result;
  }

  async deleteWebhook(dropPending = false): Promise<void> {
    await this.call("deleteWebhook", { drop_pending_updates: dropPending });
  }

  async getUpdates(args: { offset?: number; timeout: number; signal?: AbortSignal }): Promise<TelegramUpdate[]> {
    // Long-poll: we override the default fetch timeout because the caller
    // explicitly wants Telegram to hold the connection open for `timeout`
    // seconds. The AbortSignal allows graceful shutdown.
    const res = await fetch(`${BASE}/bot${this.token}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: args.offset,
        timeout: args.timeout,
        allowed_updates: ["message"],
      }),
      signal: args.signal,
    });
    if (!res.ok) {
      throw new Error(`Telegram getUpdates: HTTP ${res.status}`);
    }
    const body = (await res.json()) as ApiResult<TelegramUpdate[]>;
    if (!body.ok) {
      throw new Error(`Telegram getUpdates: ${body.error_code} ${body.description}`);
    }
    return body.result;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    // Split long replies into chunks Telegram will accept.
    for (const chunk of splitMessage(text)) {
      await this.call("sendMessage", {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
  }

  async sendChatAction(chatId: number, action: "typing"): Promise<void> {
    // Chat actions are best-effort; if the call fails, the bot still
    // works, it just won't show the "typing…" indicator.
    try {
      await this.call("sendChatAction", { chat_id: chatId, action });
    } catch {
      /* best-effort */
    }
  }
}

export function splitMessage(text: string): string[] {
  if (text.length <= TG_MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TG_MAX_MESSAGE_LENGTH) {
    // Prefer to cut at the last newline within the budget; fall back
    // to a space; fall back to the hard limit if neither is present.
    const slice = remaining.slice(0, TG_MAX_MESSAGE_LENGTH);
    let cut = slice.lastIndexOf("\n");
    if (cut < TG_MAX_MESSAGE_LENGTH * 0.5) cut = slice.lastIndexOf(" ");
    if (cut < TG_MAX_MESSAGE_LENGTH * 0.5) cut = TG_MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
