import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCrateProxy } from "../src/crateProxy.js";

const fakeCrate = fileURLToPath(new URL("./fixtures/fake-crate.mjs", import.meta.url));

describe("createCrateProxy against a fake Crate", () => {
  const cwd = mkdtempSync(join(tmpdir(), "fake-crate-"));
  let proxy: ReturnType<typeof createCrateProxy>;

  beforeAll(() => {
    process.env.DISCOGS_KEY = "parent-secret";
    proxy = createCrateProxy({ command: process.execPath, args: [fakeCrate], cwd, timeoutMs: 200 });
  });
  afterAll(async () => {
    delete process.env.DISCOGS_KEY;
    await proxy.close();
  });

  const textOf = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text;

  it("lists only allowlisted tools", async () => {
    const names = (await proxy.listTools()).map((t) => t.name).sort();
    expect(names).toEqual(["musicbrainz_echo", "musicbrainz_exit", "musicbrainz_sleep"]);
  });

  it("passes arguments through and hides parent secrets from the child", async () => {
    const out = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", { q: "Sault" })));
    expect(out.args).toEqual({ q: "Sault" });
    expect(out.discogs).toBeNull();
  });

  it("refuses a hidden tool without reaching the child", async () => {
    await expect(proxy.callTool("telegraph_post", {})).rejects.toThrow(/not available/);
    expect(existsSync(join(cwd, "telegraph-called"))).toBe(false);
  });

  it("times out a hung call with an MCP error", async () => {
    const start = Date.now();
    await expect(proxy.callTool("musicbrainz_sleep", {})).rejects.toThrow(/timed out/i);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("respawns the child after it exits", async () => {
    const before = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    await expect(proxy.callTool("musicbrainz_exit", {})).rejects.toThrow();
    const after = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    expect(after).not.toBe(before);
  });
});
