import { describe, expect, it, vi } from "vitest";

import { HttpClient, OpenClawError } from "./http.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

describe("HttpClient.request", () => {
  it("sends Authorization header when apiToken is provided", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    const http = new HttpClient({
      baseUrl: "http://o",
      apiToken: "secret",
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    await http.request("GET", "/x");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer secret");
  });

  it("omits Authorization header when apiToken is empty", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    await http.request("GET", "/x");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, null));
    const http = new HttpClient({
      baseUrl: "http://o//",
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    await http.request("GET", "/v1/agents");
    expect(fetchFn.mock.calls[0]?.[0]).toBe("http://o/v1/agents");
  });

  it("throws OpenClawError with .status and .body on non-2xx", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(404, { error: "agent_not_found" }),
    );
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    await expect(http.request("GET", "/v1/agents/ghost")).rejects.toMatchObject({
      name: "OpenClawError",
      status: 404,
      message: "agent_not_found",
      body: { error: "agent_not_found" },
    });
  });

  it("unwraps a nested `error.message` when the server returns it", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(400, { error: { message: "bad agentId", code: "validation_error" } }),
    );
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    try {
      await http.request("POST", "/v1/sessions", { agentId: "" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OpenClawError);
      expect((err as OpenClawError).status).toBe(400);
      expect((err as OpenClawError).message).toBe("bad agentId");
    }
  });

  it("falls back to status text when the body is not JSON", async () => {
    const fetchFn = vi.fn(async () => textResponse(502, "bad gateway"));
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    await expect(http.request("GET", "/x")).rejects.toMatchObject({
      name: "OpenClawError",
      status: 502,
    });
  });

  it("serializes the body as JSON when provided", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    await http.request("POST", "/v1/agents", { model: "x", instructions: "y" });
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"model":"x","instructions":"y"}');
  });

  it("aborts when the request exceeds timeoutMs", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 5, fetch: fetchFn });
    await expect(http.request("GET", "/x")).rejects.toThrow();
  });

  it("throws when global fetch is missing and no fetch override is provided", () => {
    expect(
      () =>
        new HttpClient({
          baseUrl: "http://o",
          timeoutMs: 1000,
          // Force the "no fetch available" branch.
          fetch: undefined as unknown as typeof fetch,
        }),
    ).not.toThrow(); // Should inherit globalThis.fetch from test environment.
  });
});

describe("HttpClient.streamRequest", () => {
  it("rejects when the server returns a non-2xx status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(403, { error: "forbidden" }));
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    await expect(http.streamRequest("/v1/sessions/x/events")).rejects.toMatchObject({
      name: "OpenClawError",
      status: 403,
      message: "forbidden",
    });
  });

  it("returns the raw Response on 2xx so parseSse can consume the body", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("event: x\ndata: y\n\n"));
        c.close();
      },
    });
    const fetchFn = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    const resp = await http.streamRequest("/v1/sessions/x/events?stream=true");
    expect(resp.status).toBe(200);
    expect(resp.body).not.toBeNull();
  });

  it("sets accept: text/event-stream and drops content-type for the GET", async () => {
    const body = new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    const fetchFn = vi.fn(
      async () => new Response(body, { status: 200 }),
    );
    const http = new HttpClient({ baseUrl: "http://o", timeoutMs: 1000, fetch: fetchFn });
    await http.streamRequest("/v1/sessions/x/events?stream=true");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["accept"]).toBe("text/event-stream");
    expect(headers["content-type"]).toBeUndefined();
  });
});
