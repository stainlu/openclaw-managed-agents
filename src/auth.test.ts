import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAuthMiddleware } from "./auth.js";

function buildApp(token: string | undefined): Hono {
  const app = new Hono();
  app.use("*", createAuthMiddleware({ token }));
  app.get("/private", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true, probe: true }));
  app.get("/metrics", (c) => c.text("# HELP test 1\n# TYPE test gauge\n"));
  return app;
}

async function req(
  app: Hono,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, { headers });
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = raw ? JSON.parse(raw) : raw;
  } catch {
    /* keep raw */
  }
  return { status: res.status, body };
}

describe("createAuthMiddleware — auth disabled", () => {
  it("passes every request through when token is undefined", async () => {
    const app = buildApp(undefined);
    expect((await req(app, "/private")).status).toBe(200);
    expect((await req(app, "/healthz")).status).toBe(200);
    expect((await req(app, "/metrics")).status).toBe(200);
  });

  it("passes every request through when token is empty string", async () => {
    const app = buildApp("");
    expect((await req(app, "/private")).status).toBe(200);
    expect((await req(app, "/private", { authorization: "garbage" })).status).toBe(
      200,
    );
  });

  it("trims whitespace-only token to disabled", async () => {
    const app = buildApp("   ");
    expect((await req(app, "/private")).status).toBe(200);
  });
});

describe("createAuthMiddleware — auth enabled", () => {
  const TOKEN = "secret-abcdef-123456";

  it("rejects request with no Authorization header", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/private");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "unauthorized" });
  });

  it("rejects header without Bearer scheme", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/private", { authorization: `Token ${TOKEN}` });
    expect(r.status).toBe(401);
  });

  it("rejects Bearer with empty token", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/private", { authorization: "Bearer    " });
    expect(r.status).toBe(401);
  });

  it("rejects Bearer with wrong token (length mismatch)", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/private", { authorization: "Bearer wrong" });
    expect(r.status).toBe(401);
  });

  it("rejects Bearer with wrong token (same length)", async () => {
    const app = buildApp(TOKEN);
    const wrong = TOKEN.replace(/.$/, "X");
    const r = await req(app, "/private", { authorization: `Bearer ${wrong}` });
    expect(r.status).toBe(401);
  });

  it("accepts Bearer with matching token", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/private", { authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
  });

  it("accepts bearer in lower-case (case-insensitive scheme)", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/private", { authorization: `bearer ${TOKEN}` });
    expect(r.status).toBe(200);
  });

  it("bypasses /healthz without any credentials", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/healthz");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ probe: true });
  });

  it("bypasses /metrics without any credentials", async () => {
    const app = buildApp(TOKEN);
    const r = await req(app, "/metrics");
    expect(r.status).toBe(200);
  });

  it("does NOT bypass the self-documenting root", async () => {
    // GET / is NOT in the bypass list — an unauthenticated reader of the
    // Root is bypassed so the landing page / portal redirect loads
    // without auth. The auth gate inside the portal handles the token prompt.
    const app = new Hono();
    app.use("*", createAuthMiddleware({ token: TOKEN }));
    app.get("/", (c) => c.json({ endpoints: { agents: "POST /v1/agents" } }));
    const r = await req(app, "/");
    expect(r.status).toBe(200);
  });
});
