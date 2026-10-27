import { describe, expect, test } from "vitest";
import { parseSse } from "../src/hermes.js";

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); } });
const collect = async (chunks: string[]) => { const out = []; for await (const e of parseSse(stream(chunks))) out.push(e); return out; };

describe("parseSse", () => {
  test("parses event/data frames split across arbitrary chunk boundaries", async () => {
    expect(await collect(['event: tool.sta', 'rted\ndata: {"tool":"a"}\n', '\nevent: run.completed\ndata: {"output":"x"}\n\n'])).toEqual([
      { event: "tool.started", data: { tool: "a" } },
      { event: "run.completed", data: { output: "x" } },
    ]);
  });
  test("ignores comments and handles CRLF; non-JSON data is wrapped, not thrown", async () => {
    expect(await collect([": ping\r\n\r\nevent: x\r\ndata: not json\r\n\r\n"])).toEqual([{ event: "x", data: { raw: "not json" } }]);
  });
});
