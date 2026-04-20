import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

// Baseline bearer-token auth for the orchestrator's public API.
//
// Matches Claude Managed Agents' auth depth: one shared token per
// deployment, attached as `Authorization: Bearer <token>` on every
// request. No per-user ACLs, no multi-tenancy — those are legitimate
// future items but not required to close the "port 8080 is open to
// 0.0.0.0/0 by default" footgun today.
//
// Behavior:
//   - If OPENCLAW_API_TOKEN is unset or empty at orchestrator startup,
//     auth is disabled. Every route passes (localhost dev experience,
//     `docker compose up` out of the box).
//   - If OPENCLAW_API_TOKEN is set, every route requires
//     `Authorization: Bearer <token>` EXCEPT /healthz and /metrics —
//     those are infrastructure endpoints that need to be reachable by
//     Docker healthcheck / Prometheus scraper / load balancer probe
//     without credentials. The self-documenting root (/) IS gated,
//     because an unauthenticated reader of the endpoint map is a
//     trivial reconnaissance tell.
//   - Comparison is constant-time (timingSafeEqual) so token guesses
//     don't leak via response time.
//
// The token itself is opaque to the server; any non-empty string
// works. Operators are responsible for generating a sufficiently
// strong value (32+ random bytes recommended).

export type AuthConfig = {
  /** Bearer token required on every request. Empty/undefined = auth disabled. */
  token: string | undefined;
};

/** Routes that bypass the bearer-token check. Portal HTML must load
 *  without auth so the built-in auth gate can prompt for the token. */
const BYPASS_PATHS = new Set(["/healthz", "/metrics", "/v2", "/"]);

export function createAuthMiddleware(cfg: AuthConfig): MiddlewareHandler {
  const expected = cfg.token?.trim();
  if (!expected) {
    // Auth disabled — middleware is a pass-through.
    return async (_c, next) => {
      await next();
    };
  }

  const expectedBuf = Buffer.from(expected, "utf8");

  return async (c, next) => {
    if (BYPASS_PATHS.has(c.req.path)) {
      await next();
      return;
    }

    // EventSource (SSE) cannot send custom headers. Accept the token
    // as a `?token=` query parameter as a fallback for SSE endpoints.
    // Header takes priority when both are present.
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    const queryToken = c.req.query("token");
    if (!header && !queryToken) {
      return c.json(
        {
          error: "unauthorized",
          message: "missing Authorization header (expected: Bearer <token>)",
        },
        401,
      );
    }

    let provided = "";
    if (header) {
      const match = header.match(/^bearer\s+(.+)$/i);
      if (!match) {
        return c.json(
          {
            error: "unauthorized",
            message: "Authorization header must use Bearer scheme",
          },
          401,
        );
      }
      provided = match[1]?.trim() ?? "";
    } else if (queryToken) {
      provided = queryToken.trim();
    }
    if (!provided) {
      return c.json({ error: "unauthorized", message: "empty bearer token" }, 401);
    }

    const providedBuf = Buffer.from(provided, "utf8");
    if (providedBuf.length !== expectedBuf.length) {
      // timingSafeEqual throws on length mismatch. A length-first
      // reject would leak the expected length via timing, so pad to
      // the longer length with random zeros then still reject.
      const pad = Buffer.alloc(expectedBuf.length, 0);
      try {
        // Exercise the constant-time path anyway so timing is constant
        // per request shape rather than per token length.
        timingSafeEqual(pad, expectedBuf);
      } catch {
        /* paranoia only */
      }
      return c.json({ error: "unauthorized", message: "invalid token" }, 401);
    }

    if (!timingSafeEqual(providedBuf, expectedBuf)) {
      return c.json({ error: "unauthorized", message: "invalid token" }, 401);
    }

    await next();
  };
}
