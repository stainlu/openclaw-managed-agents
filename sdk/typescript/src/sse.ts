export interface ServerSentEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Parse a fetch Response whose body is `text/event-stream` into an async
 * iterable of complete events. Follows the SSE spec: blank line dispatches,
 * multi-line `data:` accumulates with `\n` joins, comments (`:` prefix)
 * are ignored, default event type is `message`.
 *
 * Ends cleanly when the server closes the stream.
 */
export async function* parseSse(response: Response): AsyncGenerator<ServerSentEvent> {
  if (!response.body) {
    throw new Error("SSE response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  const dispatch = (): ServerSentEvent | undefined => {
    if (dataLines.length === 0 && event === undefined) {
      // Empty blank-line blocks carry no event; skip silently.
      return undefined;
    }
    const out: ServerSentEvent = {
      event: event ?? "message",
      data: dataLines.join("\n"),
    };
    if (id !== undefined) out.id = id;
    event = undefined;
    dataLines.length = 0;
    return out;
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineEnd: number;
      while ((lineEnd = indexOfLineEnd(buffer)) !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + lineEndLength(buffer, lineEnd));
        if (line.length === 0) {
          const ev = dispatch();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(":")) continue; // SSE comment
        const sep = line.indexOf(":");
        const field = sep === -1 ? line : line.slice(0, sep);
        let value = sep === -1 ? "" : line.slice(sep + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") dataLines.push(value);
        else if (field === "id") id = value;
        // `retry` and unknown fields are intentionally ignored.
      }
    }
    // Flush any buffered final event (server omitted trailing blank line).
    const final = dispatch();
    if (final) yield final;
  } finally {
    reader.releaseLock();
  }
}

function indexOfLineEnd(s: string): number {
  const lf = s.indexOf("\n");
  const cr = s.indexOf("\r");
  if (lf === -1) return cr;
  if (cr === -1) return lf;
  return Math.min(lf, cr);
}

function lineEndLength(s: string, idx: number): number {
  if (s[idx] === "\r" && s[idx + 1] === "\n") return 2;
  return 1;
}
