import type { Container, ContainerRuntime, SpawnOptions } from "./container.js";
import { GatewayWebSocketClient, GatewayWsError } from "./gateway-ws.js";

// Per-session container lifecycle pool.
//
// Before Item 4, every event spawned a fresh container and tore it down at
// the end of the run — a ~15s startup tax on every turn. This pool keeps the
// container alive between turns for the same session, so only the first
// event pays spawn time. An idle sweeper reaps containers that have been
// unused for longer than the configured threshold; the next event for that
// session respawns a fresh container and OpenClaw's SessionManager rebuilds
// the Pi AgentSession from the JSONL on the host mount.
//
// Item 7 added a GatewayWebSocketClient to each live container. After the
// HTTP /readyz check succeeds, the pool also opens a WebSocket to the
// gateway's control plane and runs the operator handshake. The router uses
// that WS client to issue cancel / steer / patch operations against the
// running session; the WS lifetime mirrors the container lifetime.
//
// The pool is in-memory only. On orchestrator restart the pool is empty;
// any containers that outlived the prior process are reaped at startup by
// DockerContainerRuntime.cleanupOrphaned(). See src/index.ts.

export type PoolConfig = {
  /** Milliseconds a container may sit unused before the sweeper reaps it. */
  idleTimeoutMs: number;
  /** Max time to wait for container /readyz on spawn. */
  readyTimeoutMs: number;
  /** How often the sweeper runs. Should be less than idleTimeoutMs / 2. */
  sweepIntervalMs: number;
  /**
   * Predicate that returns true if the named session currently has a run in
   * flight. The sweeper uses this to avoid tearing down a container that is
   * about to be used again. The caller closes over its session store to
   * provide the predicate; the pool itself has no dependency on any store,
   * which keeps the runtime layer decoupled from the orchestrator layer.
   */
  isBusy: (sessionId: string) => boolean;
  /**
   * Optional callback invoked AFTER a container is reaped by the idle
   * sweeper. Intended for ephemeral session cleanup: index.ts wires this
   * to delete the Pi JSONL and session store row when the reaped session
   * was flagged `ephemeral` (e.g., created by a keyless POST /v1/chat/completions).
   *
   * Deliberately NOT called from manual `evictSession` (e.g., cancel) or
   * `shutdown` paths — those preserve session data for inspection or
   * graceful restart. The pool stays agnostic: it passes the sessionId
   * and lets the caller decide what to clean up.
   */
  cleanupOnReap?: (sessionId: string) => Promise<void>;
};

type ActiveContainer = {
  sessionId: string;
  container: Container;
  /** Operator-role WS client for control-plane calls (abort/steer/patch). */
  wsClient: GatewayWebSocketClient;
  spawnedAt: number;
  lastUsedAt: number;
};

/** A pre-warmed container waiting to be claimed by a session. */
type WarmContainer = {
  agentId: string;
  container: Container;
  wsClient: GatewayWebSocketClient;
  spawnOptions: SpawnOptions;
  spawnedAt: number;
};

export class SessionContainerPool {
  private readonly active = new Map<string, ActiveContainer>();
  private readonly pending = new Map<string, Promise<Container>>();
  /** Pre-warmed containers keyed by agentId, waiting to be claimed. */
  private readonly warm = new Map<string, WarmContainer>();
  private sweeperHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly cfg: PoolConfig,
  ) {
    this.sweeperHandle = setInterval(() => {
      void this.reapIdle().catch((err) => {
        console.warn("[pool] reapIdle error:", err);
      });
    }, cfg.sweepIntervalMs);
    // Don't keep the event loop alive just for the sweeper — if nothing else
    // is pending, the process should still be able to exit.
    this.sweeperHandle.unref();
  }

  /**
   * Pre-warm a container for an agent template. The container boots fully
   * (spawn + /readyz + WS handshake) and waits in the warm bucket until
   * claimed by a session via acquireForSession(). Fire-and-forget — the
   * caller does not wait for completion. Silently no-ops if a warm
   * container already exists for this agent.
   */
  async warmForAgent(agentId: string, spawnOptions: SpawnOptions): Promise<void> {
    if (this.warm.has(agentId)) return;
    const container = await this.runtime.spawn(spawnOptions);
    try {
      await this.runtime.waitForReady(container, this.cfg.readyTimeoutMs);
    } catch (err) {
      await this.runtime.stop(container.id).catch(() => { /* best-effort */ });
      throw err;
    }
    const wsClient = new GatewayWebSocketClient({
      baseUrl: container.baseUrl,
      token: container.token,
      clientName: "openclaw-managed-agents",
    });
    try {
      await wsClient.connect();
    } catch (err) {
      await wsClient.close().catch(() => { /* best-effort */ });
      await this.runtime.stop(container.id).catch(() => { /* best-effort */ });
      throw err;
    }
    this.warm.set(agentId, {
      agentId,
      container,
      wsClient,
      spawnOptions,
      spawnedAt: Date.now(),
    });
    console.log(`[pool] pre-warmed container for agent ${agentId}`);
  }

  /**
   * Get a ready container for the given session. Checks three sources in
   * order: (1) existing active container for this session, (2) pre-warmed
   * container matching the agent, (3) fresh spawn. Bumps lastUsedAt.
   */
  async acquireForSession(args: {
    sessionId: string;
    spawnOptions: SpawnOptions;
    /** Agent ID for warm-pool matching. */
    agentId?: string;
  }): Promise<Container> {
    const existing = this.active.get(args.sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.container;
    }

    // Check the warm pool for a matching pre-warmed container.
    if (args.agentId) {
      const warmEntry = this.warm.get(args.agentId);
      if (warmEntry) {
        this.warm.delete(args.agentId);
        const now = Date.now();
        this.active.set(args.sessionId, {
          sessionId: args.sessionId,
          container: warmEntry.container,
          wsClient: warmEntry.wsClient,
          spawnedAt: warmEntry.spawnedAt,
          lastUsedAt: now,
        });
        console.log(
          `[pool] claimed pre-warmed container for session ${args.sessionId} (agent ${args.agentId})`,
        );
        // Replenish the warm pool in the background.
        void this.warmForAgent(args.agentId, warmEntry.spawnOptions).catch((err) => {
          console.warn(`[pool] warm-pool replenish failed for agent ${args.agentId}:`, err);
        });
        return warmEntry.container;
      }
    }

    // Deduplicate concurrent spawns for the same session. If a background
    // warm-up (triggered at session-create time) is already in progress,
    // wait for it rather than spawning a second container.
    const inflight = this.pending.get(args.sessionId);
    if (inflight) return inflight;

    const spawnPromise = this.doSpawn(args);
    this.pending.set(args.sessionId, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      this.pending.delete(args.sessionId);
    }
  }

  private async doSpawn(args: {
    sessionId: string;
    spawnOptions: SpawnOptions;
  }): Promise<Container> {
    const container = await this.runtime.spawn(args.spawnOptions);
    try {
      await this.runtime.waitForReady(container, this.cfg.readyTimeoutMs);
    } catch (err) {
      await this.runtime.stop(container.id).catch(() => {
        /* best-effort */
      });
      throw err;
    }

    const wsClient = new GatewayWebSocketClient({
      baseUrl: container.baseUrl,
      token: container.token,
      clientName: "openclaw-managed-agents",
    });
    try {
      await wsClient.connect();
    } catch (err) {
      await wsClient.close().catch(() => {
        /* best-effort */
      });
      await this.runtime.stop(container.id).catch(() => {
        /* best-effort */
      });
      const code = err instanceof GatewayWsError ? err.code : "ws_connect_failed";
      const msg = err instanceof Error ? err.message : String(err);
      throw new GatewayWsError(code, `gateway ws handshake failed: ${msg}`);
    }

    const now = Date.now();
    this.active.set(args.sessionId, {
      sessionId: args.sessionId,
      container,
      wsClient,
      spawnedAt: now,
      lastUsedAt: now,
    });
    return container;
  }

  /**
   * Get the operator-role WS client for an active session, if one exists.
   * Returns undefined when the session has no live container in the pool
   * (e.g., it was reaped by the idle sweeper or was never acquired).
   */
  getWsClient(sessionId: string): GatewayWebSocketClient | undefined {
    return this.active.get(sessionId)?.wsClient;
  }

  /** Touch the lastUsedAt timestamp for a session so the sweeper doesn't reap it. */
  touchSession(sessionId: string): void {
    const entry = this.active.get(sessionId);
    if (entry) entry.lastUsedAt = Date.now();
  }

  /**
   * Force-evict any container attached to this session. Called by the router
   * after a failed run (the container might be unhealthy) and by
   * DELETE /v1/sessions/:id. No-op if the session has no live container.
   */
  async evictSession(sessionId: string): Promise<void> {
    const entry = this.active.get(sessionId);
    if (!entry) return;
    this.active.delete(sessionId);
    await entry.wsClient.close().catch(() => {
      /* best-effort */
    });
    await this.runtime.stop(entry.container.id).catch((err) => {
      console.warn(`[pool] stop ${entry.container.id} failed:`, err);
    });
  }

  /** Snapshot of the pool for observability/logging. Not a hot path. */
  snapshot(): Array<{ sessionId: string; spawnedAt: number; lastUsedAt: number }> {
    return Array.from(this.active.values()).map((e) => ({
      sessionId: e.sessionId,
      spawnedAt: e.spawnedAt,
      lastUsedAt: e.lastUsedAt,
    }));
  }

  /**
   * Stop the sweeper and tear down every active container. Best-effort:
   * errors are swallowed so shutdown is not blocked by a single stuck stop.
   */
  async shutdown(): Promise<void> {
    if (this.sweeperHandle) {
      clearInterval(this.sweeperHandle);
      this.sweeperHandle = undefined;
    }
    const entries = Array.from(this.active.values());
    const warmEntries = Array.from(this.warm.values());
    this.active.clear();
    this.warm.clear();
    const all = [...entries.map((e) => ({ ws: e.wsClient, id: e.container.id })),
      ...warmEntries.map((e) => ({ ws: e.wsClient, id: e.container.id }))];
    await Promise.allSettled(all.map((e) => e.ws.close()));
    await Promise.allSettled(all.map((e) => this.runtime.stop(e.id)));
  }

  private async reapIdle(): Promise<void> {
    const now = Date.now();
    const threshold = now - this.cfg.idleTimeoutMs;
    // Snapshot the entries so we can mutate `this.active` while iterating.
    for (const entry of Array.from(this.active.values())) {
      if (entry.lastUsedAt >= threshold) continue;
      // Skip containers whose session currently has a run in flight. A tiny
      // race is possible (session flips to running between this check and
      // stop()); the cost is one wasted re-spawn on the next event, which
      // is acceptable for the MVP. A rigorous fix would need a per-session
      // lock, which is Item 7 scope (control endpoints) at the earliest.
      if (this.cfg.isBusy(entry.sessionId)) continue;
      this.active.delete(entry.sessionId);
      const idleSec = Math.round((now - entry.lastUsedAt) / 1000);
      console.log(
        `[pool] reaping idle container for session ${entry.sessionId} (idle ${idleSec}s)`,
      );
      await entry.wsClient.close().catch(() => {
        /* best-effort */
      });
      await this.runtime.stop(entry.container.id).catch((err) => {
        console.warn(`[pool] reap stop ${entry.container.id} failed:`, err);
      });
      // Notify the caller so it can clean up any per-session resources that
      // should NOT outlive the container. Item 8 uses this for ephemeral
      // session cleanup (delete Pi JSONL + SQLite row).
      if (this.cfg.cleanupOnReap) {
        try {
          await this.cfg.cleanupOnReap(entry.sessionId);
        } catch (err) {
          console.warn(
            `[pool] cleanupOnReap for ${entry.sessionId} failed:`,
            err,
          );
        }
      }
    }
  }
}
