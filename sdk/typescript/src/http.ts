export interface HttpClientConfig {
  baseUrl: string;
  apiToken?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class OpenClawError extends Error {
  override readonly name = "OpenClawError";
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: HttpClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = cfg.timeoutMs;
    this.fetchImpl = cfg.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        "global fetch is not available — Node 18.17+ is required, or pass a custom fetch via the `fetch` option",
      );
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.apiToken) headers["authorization"] = `Bearer ${cfg.apiToken}`;
    this.headers = headers;
  }

  get authHeader(): string | undefined {
    return this.headers["authorization"];
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(this.url(path), {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await resp.text();
      const parsed = text.length > 0 ? safeJson(text) : undefined;
      if (!resp.ok) {
        const msg = errorMessageFrom(parsed, resp.status, resp.statusText);
        throw new OpenClawError(resp.status, msg, parsed ?? text);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async textRequest(method: string, path: string, body?: unknown): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(this.url(path), {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        const parsed = safeJson(text);
        const msg = errorMessageFrom(parsed, resp.status, resp.statusText);
        throw new OpenClawError(resp.status, msg, parsed ?? text);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async streamRequest(path: string): Promise<Response> {
    const controller = new AbortController();
    // Deliberately no timeout: streaming connections live for the session.
    // The caller cancels via the returned AsyncIterable.
    const headers: Record<string, string> = {
      ...this.headers,
      accept: "text/event-stream",
    };
    delete headers["content-type"];
    const resp = await this.fetchImpl(this.url(path), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const parsed = safeJson(text);
      throw new OpenClawError(
        resp.status,
        errorMessageFrom(parsed, resp.status, resp.statusText),
        parsed ?? text,
      );
    }
    return resp;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorMessageFrom(parsed: unknown, status: number, statusText: string): string {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const err = obj["error"];
    if (typeof err === "string" && err.length > 0) return err;
    if (err && typeof err === "object") {
      const msg = (err as Record<string, unknown>)["message"];
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
    const msg = obj["message"];
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return `HTTP ${status} ${statusText}`.trim();
}
