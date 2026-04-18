/**
 * File-backed map of Telegram chat_id → openclaw session_id. Persisted
 * so conversations survive adapter restarts (and developers deploying
 * --rm adapters don't frustrate their users by resetting every chat).
 *
 * Deliberately simple: a single JSON file, written atomically (tmp +
 * rename) on every mutation. No SQLite dep, no lock file, no migration
 * story. The adapter is the single writer; concurrent writes aren't a
 * concern. File-lock semantics come from the rename() system call.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type ChatRecord = {
  chatId: number;
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
};

type FileShape = {
  version: 1;
  chats: Record<string, ChatRecord>;
};

export class ChatStorage {
  private data: FileShape = { version: 1, chats: {} };
  private loaded = false;

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed && parsed.version === 1 && parsed.chats) {
        this.data = parsed;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Any error other than "file doesn't exist yet" is worth
        // surfacing — a corrupt JSON would silently drop history.
        throw err;
      }
      // First run — init the parent directory so the first save works.
      await mkdir(dirname(this.path), { recursive: true });
    }
    this.loaded = true;
  }

  getSessionId(chatId: number): string | undefined {
    return this.data.chats[String(chatId)]?.sessionId;
  }

  async setSessionId(chatId: number, sessionId: string): Promise<void> {
    const now = Date.now();
    const existing = this.data.chats[String(chatId)];
    this.data.chats[String(chatId)] = {
      chatId,
      sessionId,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    };
    await this.save();
  }

  async touch(chatId: number): Promise<void> {
    const r = this.data.chats[String(chatId)];
    if (!r) return;
    r.lastSeenAt = Date.now();
    await this.save();
  }

  async removeChat(chatId: number): Promise<void> {
    delete this.data.chats[String(chatId)];
    await this.save();
  }

  private async save(): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
