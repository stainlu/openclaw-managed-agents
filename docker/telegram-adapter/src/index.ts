/**
 * Entrypoint for the Telegram adapter container.
 *
 * Boot flow:
 *   1. Parse config (fails fast on missing TELEGRAM_BOT_TOKEN /
 *      OPENCLAW_AGENT_ID).
 *   2. Load the chat→session mapping from disk.
 *   3. Wait for the orchestrator to report healthy (up to 2 min) —
 *      when the adapter is co-deployed via docker-compose, the
 *      orchestrator container may still be starting when ours boots.
 *   4. Verify the agent exists (catches config drift early — bot
 *      would otherwise create sessions that fail at first-turn).
 *   5. `deleteWebhook(dropPending=false)` — guard against a prior
 *      webhook registration left on the bot account from a previous
 *      deploy; getUpdates would 409 forever against a webhook'd bot.
 *   6. Start the main loop. Ctrl-C / SIGTERM stops gracefully.
 */

import { loadConfig } from "./config.js";
import { MainLoop } from "./main-loop.js";
import { OrchestratorClient } from "./orchestrator.js";
import { ChatStorage } from "./storage.js";
import { TelegramClient } from "./telegram.js";

async function waitForOrchestrator(client: OrchestratorClient, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  throw new Error(
    `orchestrator not healthy within ${timeoutMs}ms: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(
    `[telegram-adapter] starting (agent=${cfg.agentId}, orchestrator=${cfg.orchestratorUrl}, storage=${cfg.storagePath})`,
  );

  const storage = new ChatStorage(cfg.storagePath);
  await storage.load();

  const telegram = new TelegramClient(cfg.telegramBotToken);
  const orchestrator = new OrchestratorClient(cfg.orchestratorUrl, cfg.apiToken);

  await waitForOrchestrator(orchestrator, 120_000);
  console.log("[telegram-adapter] orchestrator is healthy");

  // Validate the target agent exists AND has opted into Telegram via
  // its channels.telegram.enabled flag. Refusing to start when the
  // agent hasn't opted in prevents "I pointed my adapter at the wrong
  // agent id" bugs from silently leaking messages to the wrong agent.
  const agent = await orchestrator.getAgent(cfg.agentId);
  if (!agent) {
    throw new Error(
      `agent ${cfg.agentId} not found on the orchestrator. Create it via POST /v1/agents first.`,
    );
  }
  if (agent.archivedAt !== null) {
    throw new Error(
      `agent ${cfg.agentId} is archived. Unarchive or retarget OPENCLAW_AGENT_ID to a live agent.`,
    );
  }
  if (!agent.channels.telegram.enabled) {
    throw new Error(
      `agent ${cfg.agentId} does not have channels.telegram.enabled = true. ` +
        `Set it via PATCH /v1/agents/${cfg.agentId} with body ` +
        `{"channels":{"telegram":{"enabled":true}}} (and include the current ` +
        `version for optimistic concurrency).`,
    );
  }
  console.log(`[telegram-adapter] agent ${cfg.agentId} is Telegram-enabled`);

  // getUpdates requires that no webhook be registered. An old webhook
  // from a previous deploy would make every poll 409. dropPending=false
  // keeps the backlog so users whose messages arrived during the
  // switchover aren't silently dropped.
  try {
    await telegram.deleteWebhook(false);
  } catch (err) {
    console.warn("[telegram-adapter] deleteWebhook warning:", err instanceof Error ? err.message : err);
  }

  const loop = new MainLoop(cfg, telegram, orchestrator, storage);

  // Graceful shutdown: tell the loop to stop after the current
  // getUpdates call completes. No force-kill of in-flight turns —
  // those complete in the orchestrator regardless.
  const shutdown = (sig: string) => {
    console.log(`[telegram-adapter] received ${sig}, stopping`);
    loop.stop();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("[telegram-adapter] polling Telegram for updates");
  await loop.run();
  console.log("[telegram-adapter] stopped");
}

main().catch((err) => {
  console.error("[telegram-adapter] fatal:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
