import { describe, expect, it } from "vitest";
import { SessionEventQueue } from "./event-queue.js";

function makeEvent(content: string, model?: string) {
  return { content, model, enqueuedAt: Date.now() };
}

describe("SessionEventQueue", () => {
  it("starts empty", () => {
    const q = new SessionEventQueue();
    expect(q.size("ses_x")).toBe(0);
    expect(q.shift("ses_x")).toBeUndefined();
  });

  it("enqueues and shifts in FIFO order", () => {
    const q = new SessionEventQueue();
    q.enqueue("ses_x", makeEvent("first"));
    q.enqueue("ses_x", makeEvent("second"));
    q.enqueue("ses_x", makeEvent("third"));
    expect(q.size("ses_x")).toBe(3);
    expect(q.shift("ses_x")?.content).toBe("first");
    expect(q.shift("ses_x")?.content).toBe("second");
    expect(q.shift("ses_x")?.content).toBe("third");
    expect(q.shift("ses_x")).toBeUndefined();
    expect(q.size("ses_x")).toBe(0);
  });

  it("isolates queues across sessions", () => {
    const q = new SessionEventQueue();
    q.enqueue("ses_a", makeEvent("alpha"));
    q.enqueue("ses_b", makeEvent("bravo"));
    q.enqueue("ses_a", makeEvent("alpha-2"));
    expect(q.size("ses_a")).toBe(2);
    expect(q.size("ses_b")).toBe(1);
    expect(q.shift("ses_a")?.content).toBe("alpha");
    expect(q.shift("ses_b")?.content).toBe("bravo");
    expect(q.shift("ses_b")).toBeUndefined();
    expect(q.size("ses_a")).toBe(1);
  });

  it("clear returns the dropped count and empties the queue", () => {
    const q = new SessionEventQueue();
    q.enqueue("ses_x", makeEvent("a"));
    q.enqueue("ses_x", makeEvent("b"));
    const dropped = q.clear("ses_x");
    expect(dropped).toBe(2);
    expect(q.size("ses_x")).toBe(0);
    expect(q.shift("ses_x")).toBeUndefined();
  });

  it("clear on an empty session returns 0", () => {
    const q = new SessionEventQueue();
    expect(q.clear("ses_never")).toBe(0);
  });

  it("preserves per-event fields (content + model)", () => {
    const q = new SessionEventQueue();
    q.enqueue("ses_x", makeEvent("say hi", "anthropic/claude-sonnet-4-6"));
    const out = q.shift("ses_x");
    expect(out?.content).toBe("say hi");
    expect(out?.model).toBe("anthropic/claude-sonnet-4-6");
    expect(typeof out?.enqueuedAt).toBe("number");
  });
});
