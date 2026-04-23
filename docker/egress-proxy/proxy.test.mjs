import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";

const HEALTHZ_PORT = 18119;
const HTTP_PORT = 18118;
const DNS_PORT = 15353;

let child;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: HEALTHZ_PORT,
        path,
        method: "GET",
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitForReady() {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await get("/healthz");
      if (res.statusCode === 200) return;
      lastError = new Error(`unexpected status ${res.statusCode}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastError ?? new Error("proxy did not become ready");
}

before(async () => {
  child = spawn(process.execPath, ["./docker/egress-proxy/proxy.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENCLAW_EGRESS_ALLOWED_HOSTS: JSON.stringify(["example.com"]),
      OPENCLAW_EGRESS_SESSION_ID: "ses_proxytest",
      OPENCLAW_EGRESS_HTTP_PORT: String(HTTP_PORT),
      OPENCLAW_EGRESS_HEALTHZ_PORT: String(HEALTHZ_PORT),
      OPENCLAW_EGRESS_DNS_PORT: String(DNS_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady();
});

after(async () => {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 1000).unref();
  });
});

describe("egress-proxy health endpoints", () => {
  it("serves /healthz", async () => {
    const res = await get("/healthz");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /"ok":true/);
  });

  it("serves /readyz as a compatibility alias", async () => {
    const res = await get("/readyz");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /"ok":true/);
  });

  it("returns 404 for unrelated paths", async () => {
    const res = await get("/nope");
    assert.equal(res.statusCode, 404);
  });
});
