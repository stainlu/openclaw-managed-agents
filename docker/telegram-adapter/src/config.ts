/**
 * Environment parsing for the Telegram adapter. Fails loud at startup if
 * required variables are missing — we'd rather refuse to start than boot
 * a bot that sends "undefined" to users.
 */

export type Config = {
  telegramBotToken: string;
  agentId: string;
  orchestratorUrl: string;
  apiToken: string | undefined;
  storagePath: string;
  /** Long-poll timeout handed to Telegram. 25s is the default Telegram
   *  recommendation; puts Telegram in charge of connection pacing. */
  pollTimeoutSeconds: number;
  /** Drop updates older than this when catching up after a restart
   *  (seconds). Prevents the bot from replaying a week of queued
   *  messages when you restart it after a long outage. */
  maxUpdateAgeSeconds: number;
  /** Per-session turn timeout: how long we wait for an agent to go
   *  from running → idle before bailing and messaging the user. */
  turnTimeoutMs: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`${name} is required; set it in your environment / .env file`);
  }
  return v.trim();
}

export function loadConfig(): Config {
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    agentId: requireEnv("OPENCLAW_AGENT_ID"),
    orchestratorUrl: process.env.OPENCLAW_ORCHESTRATOR_URL?.trim() || "http://openclaw-orchestrator:8080",
    apiToken: process.env.OPENCLAW_API_TOKEN?.trim() || undefined,
    storagePath: process.env.STORAGE_PATH?.trim() || "/state/chats.json",
    pollTimeoutSeconds: Math.max(1, Math.min(60, Number(process.env.POLL_TIMEOUT_SECONDS) || 25)),
    maxUpdateAgeSeconds: Math.max(10, Number(process.env.MAX_UPDATE_AGE_SECONDS) || 300),
    turnTimeoutMs: Math.max(10_000, Number(process.env.TURN_TIMEOUT_MS) || 300_000),
  };
}
