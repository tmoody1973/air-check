import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";
import { readTokenFile, refusalKey } from "../src/tokens.js";

const base = { INGEST_TOKEN: "i".repeat(48), CONVEX_URL: "https://x.convex.cloud" };

describe("config", () => {
  test("INGEST_TOKEN (32+) and CONVEX_URL are required; errors never echo a value", () => {
    expect(() => loadConfig({ ...base, INGEST_TOKEN: "short-secret" })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...base, INGEST_TOKEN: "short-secret" })).not.toThrow(/short-secret/);
    expect(() => loadConfig({ INGEST_TOKEN: base.INGEST_TOKEN })).toThrow(/CONVEX_URL/);
  });

  test("defaults: hourly scan, 60 s passes, the VM's folders; each source optional (null = not configured)", () => {
    expect(loadConfig(base)).toEqual({
      ...{ convexUrl: base.CONVEX_URL, ingestToken: base.INGEST_TOKEN },
      tokenDir: "/home/user/.aircheck/ingest-tokens", inboxDir: "/home/user/aircheck-audio/inbox", preparedDir: "/home/user/aircheck-audio/prepared",
      scanMs: 3_600_000, pollMs: 60_000, box: null, google: null, dropbox: null,
    });
  });

  test("Box needs all four values; the folder id must be digits", () => {
    const box = { BOX_CLIENT_ID: "a", BOX_CLIENT_SECRET: "b", BOX_ENTERPRISE_ID: "7", BOX_FOLDER_ID: "123" };
    expect(loadConfig({ ...base, ...box }).box).toEqual({ clientId: "a", clientSecret: "b", enterpriseId: "7", folderId: "123" });
    expect(loadConfig({ ...base, ...box, BOX_ENTERPRISE_ID: "" }).box).toBeNull();
    expect(() => loadConfig({ ...base, ...box, BOX_FOLDER_ID: "../0" })).toThrow(/digits/);
    const apps = loadConfig({ ...base, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", DROPBOX_APP_KEY: "d", DROPBOX_APP_SECRET: "ds", SCAN_MS: "120000", POLL_MS: "5" });
    expect([apps.google, apps.dropbox, apps.scanMs, apps.pollMs]).toEqual([{ clientId: "g", clientSecret: "gs" }, { clientId: "d", clientSecret: "ds" }, 120_000, 60_000]);
  });
});

describe("token files", () => {
  test("missing, half-written, or ok; the refusal key changes with connectedAt and never contains the token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tok-"));
    expect(await readTokenFile(join(dir, "google.json"))).toEqual({ kind: "missing" });
    await writeFile(join(dir, "google.json"), "{\"refresh_");
    expect(await readTokenFile(join(dir, "google.json"))).toEqual({ kind: "invalid" });
    await writeFile(join(dir, "google.json"), JSON.stringify({ refresh_token: "rt-1", account: "Google account", connectedAt: 5 }));
    expect(await readTokenFile(join(dir, "google.json"))).toEqual({ kind: "ok", refreshToken: "rt-1", account: "Google account", connectedAt: 5 });
    if (process.getuid?.() !== 0) {
      // M4: a file this service can't read (wrong owner) is its own state, not a bad credential.
      await chmod(join(dir, "google.json"), 0);
      expect(await readTokenFile(join(dir, "google.json"))).toEqual({ kind: "unreadable" });
    }
    expect(refusalKey("google", "rt-1", 5)).not.toBe(refusalKey("google", "rt-1", 6));
    expect(refusalKey("google", "rt-1", 5)).not.toContain("rt-1");
  });
});
