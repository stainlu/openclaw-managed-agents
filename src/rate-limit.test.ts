import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuthMiddleware } from "./auth.js";
import {
  rateLimitRejectionsTotal,
  registry as metricsRegistry,
} from "./metrics.js";
import {
  createRateLimitMiddleware,
  RateLimiter,
  type RateLimitMiddlewareOptions,
} from "./rate-limit.js";

function buildApp(opts: RateLimitMiddlewareOptions): Hono {
  const app = new Hono();
  app.use("*", createRateLimitMiddleware(opts));
  app.get("/private", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/metrics", (c) => c.text("# metrics"));
  return app;
}

async function req(
  app: Hono,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await app.request(path, { headers });
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = raw ? JSON.parse(raw) : raw;
  } catch {
    /* keep raw */
  }
  return { status: res.status, body, headers: res.headers };
}

// Hono's .request() test harness sets no socket, so IP fallback keys as
// undefined. We use explicit Bearer tokens in most tests so requests key
// deterministically by token digest.
function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("RateLimiter class — core algorithm", () => {
  it("allows up to capacity immediately, then rejects", () => {
    const rl = new RateLimiter({ rpm: 5, now: () => 0, enableSweeper: false });
    for (let i = 0; i < 5; i++) {
      expect(rl.check("k").allowed).toBe(true);
    }
    const rejected = rl.check("k");
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(rejected.limit).toBe(5);
    }
    rl.stop();
  });

  it("refills tokens at RPM/60 per second", () => {
    let t = 0;
    const rl = new RateLimiter({ rpm: 60, now: () => t, enableSweeper: false });
    // Burn the full bucket.
    for (let i = 0; i < 60; i++) expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    // Advance 1s → refill exactly 1 token.
    t = 1000;
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    // Advance 10s → refill 10 tokens.
    t = 11_000;
    for (let i = 0; i < 10; i++) expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    rl.stop();
  });

  it("caps refill at capacity (no accumulation while idle)", () => {
    let t = 0;
    const rl = new RateLimiter({ rpm: 5, now: () => t, enableSweeper: false });
    // First request primes the bucket (4 left).
    expect(rl.check("k").allowed).toBe(true);
    // Advance 1 full hour — refill is capped at capacity.
    t = 60 * 60_000;
    for (let i = 0; i < 5; i++) expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    rl.stop();
  });

  it("keys independently — one saturated key does not block another", () => {
    const rl = new RateLimiter({ rpm: 2, now: () => 0, enableSweeper: false });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    rl.stop();
  });

  it("GC removes buckets idle past 10 minutes", () => {
    let t = 0;
    const rl = new RateLimiter({ rpm: 5, now: () => t, enableSweeper: false });
    rl.check("stale");
    rl.check("fresh");
    expect(rl.size()).toBe(2);
    // Stale idle > 10 min; fresh still alive on next call.
    t = 11 * 60_000;
    rl.check("fresh");
    rl.gc();
    expect(rl.size()).toBe(1);
    rl.stop();
  });

  it("is disabled (pass-through) when rpm=0", () => {
    const rl = new RateLimiter({ rpm: 0, now: () => 0, enableSweeper: false });
    for (let i = 0; i < 10_000; i++) {
      expect(rl.check("k").allowed).toBe(true);
    }
    // No bucket state kept in disabled mode.
    expect(rl.size()).toBe(0);
    rl.stop();
  });
});

describe("createRateLimitMiddleware — Hono integration", () => {
  beforeEach(() => {
    rateLimitRejectionsTotal.reset();
  });

  it("pass-through when rpm=0", async () => {
    const app = buildApp({ rpm: 0, enableSweeper: false });
    for (let i = 0; i < 50; i++) {
      expect((await req(app, "/private", auth("t"))).status).toBe(200);
    }
  });

  it("rejects with 429 + Retry-After once bucket is empty", async () => {
    const app = buildApp({ rpm: 3, now: () => 0, enableSweeper: false });
    for (let i = 0; i < 3; i++) {
      expect((await req(app, "/private", auth("t"))).status).toBe(200);
    }
    const blocked = await req(app, "/private", auth("t"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(blocked.headers.get("x-ratelimit-limit")).toBe("3");
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(blocked.body).toMatchObject({ error: "rate_limited" });
  });

  it("bypasses /healthz and /metrics even when rpm is tiny", async () => {
    const app = buildApp({ rpm: 1, now: () => 0, enableSweeper: false });
    for (let i = 0; i < 50; i++) {
      expect((await req(app, "/healthz", auth("t"))).status).toBe(200);
      expect((await req(app, "/metrics", auth("t"))).status).toBe(200);
    }
  });

  it("tracks separate buckets per Bearer token", async () => {
    const app = buildApp({ rpm: 2, now: () => 0, enableSweeper: false });
    // Token A uses its full 2.
    expect((await req(app, "/private", auth("a"))).status).toBe(200);
    expect((await req(app, "/private", auth("a"))).status).toBe(200);
    expect((await req(app, "/private", auth("a"))).status).toBe(429);
    // Token B still has its full 2 — keys don't cross.
    expect((await req(app, "/private", auth("b"))).status).toBe(200);
    expect((await req(app, "/private", auth("b"))).status).toBe(200);
    expect((await req(app, "/private", auth("b"))).status).toBe(429);
  });

  it("lets unidentifiable requests through (no token, no IP)", async () => {
    // Hono's test harness has no peer IP, no XFF header, no Bearer.
    // Rate limiting can't fairly key the request, so it passes — auth
    // middleware is the next gate and will 401 it.
    const app = buildApp({ rpm: 1, enableSweeper: false });
    for (let i = 0; i < 10; i++) {
      expect((await req(app, "/private")).status).toBe(200);
    }
  });

  it("sets X-RateLimit-Limit/Remaining on successful responses", async () => {
    const app = buildApp({ rpm: 5, now: () => 0, enableSweeper: false });
    const first = await req(app, "/private", auth("t"));
    expect(first.status).toBe(200);
    expect(first.headers.get("x-ratelimit-limit")).toBe("5");
    expect(Number(first.headers.get("x-ratelimit-remaining"))).toBe(4);
  });

  it("increments rate_limit_rejections_total on 429", async () => {
    const app = buildApp({ rpm: 1, now: () => 0, enableSweeper: false });
    await req(app, "/private", auth("x"));
    await req(app, "/private", auth("x"));
    const text = await metricsRegistry.getSingleMetricAsString(
      "rate_limit_rejections_total",
    );
    // Exactly one token-kind rejection recorded (the registry adds a
    // `service` default label to every metric).
    expect(text).toMatch(/rate_limit_rejections_total\{[^}]*kind="token"[^}]*\}\s+1/);
  });

  it("keys by x-forwarded-for when no Bearer token is provided", async () => {
    const app = buildApp({ rpm: 1, now: () => 0, enableSweeper: false });
    // Same IP hits its limit.
    expect((await req(app, "/private", { "x-forwarded-for": "1.2.3.4" })).status).toBe(200);
    expect((await req(app, "/private", { "x-forwarded-for": "1.2.3.4" })).status).toBe(429);
    // Different IP has its own bucket.
    expect((await req(app, "/private", { "x-forwarded-for": "5.6.7.8" })).status).toBe(200);
  });

  it("runs BEFORE auth — unauthed floods hit 429 before 401", async () => {
    // Mirror the exact middleware ordering used in server.ts: rate limit
    // first, then auth. An unauthenticated flood should exhaust the
    // bucket and see 429 on overflow, not an unlimited stream of 401s
    // (which would let an attacker burn orchestrator CPU cheaply).
    const app = new Hono();
    app.use("*", createRateLimitMiddleware({ rpm: 1, now: () => 0, enableSweeper: false }));
    app.use("*", createAuthMiddleware({ token: "the-real-token" }));
    app.get("/private", (c) => c.json({ ok: true }));

    // First request has no Authorization — it passes the rate limiter
    // (consumes 1 token), reaches auth, gets 401.
    const first = await req(app, "/private", { "x-forwarded-for": "9.9.9.9" });
    expect(first.status).toBe(401);

    // Second request from the same IP — bucket is empty, so rate limit
    // rejects it BEFORE auth ever runs. Proves the ordering invariant.
    const second = await req(app, "/private", { "x-forwarded-for": "9.9.9.9" });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("takes the left-most XFF entry as the client IP", async () => {
    const app = buildApp({ rpm: 1, now: () => 0, enableSweeper: false });
    // Proxy chain: client=1.1.1.1, then cdn, then lb.
    expect(
      (await req(app, "/private", { "x-forwarded-for": "1.1.1.1, cdn, lb" }))
        .status,
    ).toBe(200);
    expect(
      (await req(app, "/private", { "x-forwarded-for": "1.1.1.1, cdn, lb" }))
        .status,
    ).toBe(429);
  });
});
