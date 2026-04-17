import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

import { getLogger } from "./log.js";
import { rateLimitRejectionsTotal } from "./metrics.js";

// Per-caller rate limiter. Applied BEFORE auth so unauthenticated
// floods can't exhaust the orchestrator even while auth middleware
// cheaply rejects them.
//
// Keying. Prefer the Bearer token when present — authenticated callers
// get their own bucket per token. Fall back to the client IP when no
// token is present (unauthenticated deploys, or requests that are
// about to 401). Behind a proxy, `x-forwarded-for` is honored; the
// left-most entry is taken as the original client IP. Keys are
// prefixed (`t:` / `i:`) so a token literally equal to an IP cannot
// collide.
//
// Algorithm. Token bucket. Capacity = RPM (one minute's worth of
// burst), refill = RPM/60 tokens per second. 1 token consumed per
// request. Simple, predictable, burst-friendly.
//
// Bypass. `/healthz` and `/metrics` are exempt — they must stay
// reachable for load balancer probes and Prometheus scrapes even
// under load.

export type RateLimitConfig = {
  /** Requests per minute per key. 0 or undefined = disabled. */
  rpm: number;
  /** Injected clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Injected sweeper disabled for tests. Defaults to true in prod. */
  enableSweeper?: boolean;
};

const BYPASS_PATHS = new Set(["/healthz", "/metrics"]);
const GC_AFTER_MS = 10 * 60_000; // drop idle buckets after 10 min
const GC_INTERVAL_MS = 60_000;

type Bucket = {
  tokens: number;
  /** ms timestamp of last refill + last touch. */
  lastRefillMs: number;
};

type RateLimitDecision =
  | { allowed: true; remaining: number; limit: number }
  | { allowed: false; retryAfterSec: number; limit: number };

export class RateLimiter {
  private readonly rpm: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly sweeper: NodeJS.Timeout | undefined;

  constructor(cfg: RateLimitConfig) {
    this.rpm = Math.max(0, Math.floor(cfg.rpm));
    this.capacity = this.rpm;
    this.refillPerMs = this.rpm / 60_000;
    this.now = cfg.now ?? Date.now;
    if (this.rpm > 0 && cfg.enableSweeper !== false) {
      this.sweeper = setInterval(() => this.gc(), GC_INTERVAL_MS);
      // Don't keep the event loop alive just for GC.
      this.sweeper.unref?.();
    } else {
      this.sweeper = undefined;
    }
  }

  /** Primary entry point. Returns a decision; callers enforce it. */
  check(key: string): RateLimitDecision {
    if (this.rpm === 0) {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY, limit: 0 };
    }
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: this.capacity, lastRefillMs: now };
    // Refill since last touch.
    if (existing) {
      const elapsed = Math.max(0, now - existing.lastRefillMs);
      const refill = elapsed * this.refillPerMs;
      bucket.tokens = Math.min(this.capacity, existing.tokens + refill);
      bucket.lastRefillMs = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: this.rpm,
      };
    }
    // Not enough tokens. Compute wait until we have >= 1 token.
    const missing = 1 - bucket.tokens;
    const waitMs = missing / this.refillPerMs;
    this.buckets.set(key, bucket);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)),
      limit: this.rpm,
    };
  }

  /** Remove buckets that have been idle long enough they've fully refilled and aren't in use. */
  gc(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefillMs > GC_AFTER_MS) {
        this.buckets.delete(key);
      }
    }
  }

  /** Visible for tests. */
  size(): number {
    return this.buckets.size;
  }

  /** Stop the GC interval so the process can exit cleanly. */
  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }
}

export type RateLimitMiddlewareOptions = RateLimitConfig;

export function createRateLimitMiddleware(
  cfg: RateLimitMiddlewareOptions,
): MiddlewareHandler {
  const limiter = new RateLimiter(cfg);
  const log = getLogger("rate-limit");
  if (cfg.rpm === 0) {
    // Pass-through. No limiter state needed.
    return async (_c, next) => {
      await next();
    };
  }
  return async (c, next) => {
    if (BYPASS_PATHS.has(c.req.path)) {
      await next();
      return;
    }
    const { key, kind } = extractKey(c);
    if (!key) {
      // No token, no identifiable IP. Let the request through — rate
      // limiting by shared global bucket would punish all-unauthed
      // loopback usage. Auth middleware will handle it next.
      await next();
      return;
    }
    const decision = limiter.check(key);
    if (!decision.allowed) {
      rateLimitRejectionsTotal.inc({ kind });
      log.warn(
        {
          kind,
          key_hint: keyHint(key),
          path: c.req.path,
          method: c.req.method,
          retry_after: decision.retryAfterSec,
          limit: decision.limit,
        },
        "rate limited",
      );
      c.header("Retry-After", String(decision.retryAfterSec));
      c.header("X-RateLimit-Limit", String(decision.limit));
      c.header("X-RateLimit-Remaining", "0");
      return c.json(
        {
          error: "rate_limited",
          message: `rate limit exceeded (${decision.limit} req/min). retry in ${decision.retryAfterSec}s`,
        },
        429,
      );
    }
    c.header("X-RateLimit-Limit", String(decision.limit));
    if (Number.isFinite(decision.remaining)) {
      c.header("X-RateLimit-Remaining", String(decision.remaining));
    }
    await next();
  };
}

/** Resolve a stable, unguessable-from-logs key for this request. */
function extractKey(c: Context): { key: string | undefined; kind: "token" | "ip" } {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  const bearerMatch = auth?.match(/^bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();
  if (token) {
    const digest = createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
    return { key: `t:${digest}`, kind: "token" };
  }
  const ip = extractIp(c);
  if (ip) return { key: `i:${ip}`, kind: "ip" };
  return { key: undefined, kind: "ip" };
}

function extractIp(c: Context): string | undefined {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  // Hono doesn't standardize peer access across adapters. In node-server
  // the raw request carries `socket.remoteAddress`. Best-effort only.
  const raw = (c.req.raw as unknown as { socket?: { remoteAddress?: string } })
    .socket?.remoteAddress;
  return raw ?? undefined;
}

function keyHint(key: string): string {
  // Already hashed for tokens; already just an IP for ip-keys.
  // Truncate for tidiness in log output.
  return key.length > 40 ? `${key.slice(0, 40)}…` : key;
}
