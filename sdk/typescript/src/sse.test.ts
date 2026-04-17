import { describe, expect, it } from "vitest";

import { parseSse, type ServerSentEvent } from "./sse.js";

function streamFrom(parts: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(response: Response): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  for await (const ev of parseSse(response)) events.push(ev);
  return events;
}

describe("parseSse", () => {
  it("parses a single event with event/id/data fields", async () => {
    const events = await collect(
      streamFrom(["event: user.message\nid: evt_1\ndata: hello\n\n"]),
    );
    expect(events).toEqual([{ event: "user.message", id: "evt_1", data: "hello" }]);
  });

  it("defaults event type to 'message' when the event field is omitted", async () => {
    const events = await collect(streamFrom(["data: plain\n\n"]));
    expect(events).toEqual([{ event: "message", data: "plain" }]);
  });

  it("accumulates multi-line data with '\\n' between lines", async () => {
    const events = await collect(
      streamFrom(["event: e\ndata: {\"a\":1,\n", "data: \"b\":2}\n\n"]),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("e");
    expect(events[0]?.data).toBe('{"a":1,\n"b":2}');
    expect(JSON.parse(events[0]!.data)).toEqual({ a: 1, b: 2 });
  });

  it("skips comment lines that start with ':'", async () => {
    const events = await collect(
      streamFrom([": heartbeat comment\n\nevent: real\ndata: yes\n\n"]),
    );
    expect(events).toEqual([{ event: "real", data: "yes" }]);
  });

  it("strips a single leading space from the field value", async () => {
    const events = await collect(streamFrom(["data:no-space\ndata: one-space\n\n"]));
    expect(events[0]?.data).toBe("no-space\none-space");
  });

  it("handles CRLF line endings", async () => {
    const events = await collect(
      streamFrom(["event: crlf\r\ndata: ok\r\n\r\n"]),
    );
    expect(events).toEqual([{ event: "crlf", data: "ok" }]);
  });

  it("handles a chunk boundary mid-field", async () => {
    const events = await collect(
      streamFrom(["event: split", "ter\ndata: val", "ue\n\n"]),
    );
    expect(events).toEqual([{ event: "splitter", data: "value" }]);
  });

  it("handles a chunk boundary between the final data line and the blank dispatch", async () => {
    const events = await collect(
      streamFrom(["event: late\ndata: here", "\n", "\n"]),
    );
    expect(events).toEqual([{ event: "late", data: "here" }]);
  });

  it("flushes the final event if the server closes without a trailing blank line", async () => {
    const events = await collect(streamFrom(["event: tail\ndata: last\n"]));
    expect(events).toEqual([{ event: "tail", data: "last" }]);
  });

  it("ignores unknown fields like 'retry' without breaking dispatch", async () => {
    const events = await collect(
      streamFrom(["retry: 5000\nevent: keep\ndata: yes\n\n"]),
    );
    expect(events).toEqual([{ event: "keep", data: "yes" }]);
  });

  it("preserves heartbeat events so callers can filter them", async () => {
    const events = await collect(
      streamFrom(["event: heartbeat\ndata: ping\n\nevent: real\ndata: hi\n\n"]),
    );
    expect(events).toEqual([
      { event: "heartbeat", data: "ping" },
      { event: "real", data: "hi" },
    ]);
  });

  it("throws when the response has no body", async () => {
    const resp = new Response(null, { status: 200 });
    await expect(async () => {
      for await (const _ of parseSse(resp)) void _;
    }).rejects.toThrow(/no body/i);
  });
});
