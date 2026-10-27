export interface SseEvent { event: string; data: Record<string, unknown> }
export interface RunInfo { status: string; output?: string }

/** Parses a Server-Sent Events body into {event, data}. Comments are ignored; non-JSON data is kept as {raw}. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  const frame = (text: string): SseEvent | null => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) return null;
    const raw = data.join("\n");
    try {
      const parsed: unknown = JSON.parse(raw);
      const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
      // Hermes payloads carry their own name in data.event; an `event:` line wins when present.
      return { event: event ?? (typeof obj.event === "string" ? obj.event : "message"), data: obj };
    } catch {
      return { event: event ?? "message", data: { raw } };
    }
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const f = frame(buf.slice(0, i));
      buf = buf.slice(i + 2);
      if (f) yield f;
    }
  }
  const tail = frame(buf);
  if (tail) yield tail;
}

/** A non-2xx answer from Hermes. Carries the status only, never the body. */
export class HermesError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const REQUEST_TIMEOUT_MS = 30_000;

/** The Hermes Runs API for one sandbox (loopback, bearer token). */
export class HermesClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  /** `timeout: false` is for the events stream, which may be idle for a long time. */
  private async call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, timeout = true): Promise<Response> {
    const res = await fetch(this.baseUrl + path, {
      ...init, headers: { authorization: `Bearer ${this.token}`, ...init.headers },
      ...(timeout && { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    });
    if (!res.ok) throw new HermesError(res.status, `hermes ${init.method ?? "GET"} ${path.replace(/\/[^/]*$/, "/…")} -> ${res.status}`); // status only: never the body
    return res;
  }

  /** Idempotent by `key`: repeating a start with the same key returns the same run. */
  async start(input: string, key: string, sessionId?: string, instructions?: string): Promise<string> {
    const res = await this.call("/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ input, ...(instructions !== undefined && { instructions }), ...(sessionId !== undefined && { session_id: sessionId }) }),
    });
    const { run_id } = (await res.json()) as { run_id?: string };
    if (!run_id) throw new Error("hermes start returned no run_id");
    return run_id;
  }

  async stop(runId: string): Promise<void> {
    await this.call(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
  }

  async get(runId: string): Promise<RunInfo> {
    const j = (await (await this.call(`/v1/runs/${encodeURIComponent(runId)}`)).json()) as { status?: string; output?: unknown };
    return { status: String(j.status ?? "unknown"), output: typeof j.output === "string" ? j.output : undefined };
  }

  async *events(runId: string): AsyncGenerator<SseEvent> {
    const res = await this.call(`/v1/runs/${encodeURIComponent(runId)}/events`, { headers: { accept: "text/event-stream" } }, false);
    if (!res.body) throw new Error("hermes events had no body");
    yield* parseSse(res.body);
  }
}
