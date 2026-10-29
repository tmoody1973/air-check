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
    expect(names).toEqual(["bandcamp_search_bandcamp", "musicbrainz_echo", "musicbrainz_exit", "musicbrainz_sleep", "wikipedia_links"]);
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

  it("refuses the fan collection tool without reaching the child", async () => {
    await expect(proxy.callTool("bandcamp_get_fan_collection", { username: "x" })).rejects.toThrow(/not available/);
    expect(existsSync(join(cwd, "bandcamp_get_fan_collection-called"))).toBe(false);
  });

  it("refuses the URL-taking page tools without reaching the child (Hard Rule 5)", async () => {
    await expect(proxy.callTool("bandcamp_get_artist_page", { url: "https://artist.bandcamp.com" })).rejects.toThrow(
      /not available/,
    );
    expect(existsSync(join(cwd, "bandcamp_get_artist_page-called"))).toBe(false);
  });

  it("URL guard (defence in depth) refuses a non-Bandcamp URL on an allowed tool without reaching the child", async () => {
    const call = proxy.callTool("bandcamp_search_bandcamp", { url: "https://169.254.169.254/latest/meta-data" });
    await expect(call).rejects.toThrow(/refused/i);
    await expect(call).rejects.not.toThrow(/169\.254/);
    expect(existsSync(join(cwd, "bandcamp_search_bandcamp-called"))).toBe(false);
  });

  it("forwards a Bandcamp URL on an allowed tool", async () => {
    const r = await proxy.callTool("bandcamp_search_bandcamp", { url: "https://artist.bandcamp.com/album/x" });
    expect(textOf(r)).toBe("fetched");
  });

  it("times out a hung call with an MCP error", async () => {
    const start = Date.now();
    await expect(proxy.callTool("musicbrainz_sleep", {})).rejects.toThrow(/timed out/i);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("replaces a child after three timeouts in a row", async () => {
    const before = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    for (let i = 0; i < 3; i++) await expect(proxy.callTool("musicbrainz_sleep", {})).rejects.toThrow(/timed out/i);
    const after = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    expect(after).not.toBe(before);
  });

  it("keeps the child after fewer than three timeouts in a row", async () => {
    const before = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    for (let i = 0; i < 2; i++) await expect(proxy.callTool("musicbrainz_sleep", {})).rejects.toThrow(/timed out/i);
    await proxy.callTool("musicbrainz_echo", {}); // a success resets the count
    await expect(proxy.callTool("musicbrainz_sleep", {})).rejects.toThrow(/timed out/i);
    const after = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    expect(after).toBe(before);
  });

  it("respawns the child after it exits", async () => {
    const before = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    await expect(proxy.callTool("musicbrainz_exit", {})).rejects.toThrow();
    const after = JSON.parse(textOf(await proxy.callTool("musicbrainz_echo", {}))).pid;
    expect(after).not.toBe(before);
  });
});
