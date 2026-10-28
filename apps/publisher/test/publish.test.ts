import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toMixcloudFields } from "@aircheck/core";
import { afterEach, describe, expect, test } from "vitest";
import { MIXCLOUD_UPLOAD_URL } from "../src/mixcloud.js";
import { publishPass, startup, statusReporter, unlistedTest, type PublishDeps } from "../src/publish.js";
import { openState } from "../src/state.js";
import {
  ACCESS_TOKEN, fakeConvex, fakeServer, JPEG, okUpload, queueItem, readBody, recordUpload, sha256, workspace,
} from "./helpers.js";

type Server = Awaited<ReturnType<typeof fakeServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function setup(opts: { upload?: NonNullable<Parameters<typeof fakeServer>[0]>["upload"]; cover?: Buffer; items?: number; publishedToday?: number; noCover?: boolean } = {}) {
  server = await fakeServer({ upload: opts.upload, cover: opts.cover });
  const ws = await workspace();
  const items = Array.from({ length: opts.items ?? 1 }, (_, i) =>
    queueItem(ws.mp3, { id: `pkg-10-${2 + 7 * i}-26`, showDate: `2026-10-${String(2 + 7 * i).padStart(2, "0")}` }, opts.noCover ? { coverStorageId: undefined } : {}),
  );
  for (const p of items) await ws.addMp3(p.packageId);
  const fake = fakeConvex(items, { publishedToday: opts.publishedToday, coverBase: server.base });
  const logs: string[] = [];
  const alerts: string[] = [];
  const sleeps: number[] = [];
  const exits: number[] = [];
  const deps = async (): Promise<PublishDeps> => ({
    convex: fake.convex, log: (l) => logs.push(l), tokenFile: ws.tokenFile, preparedDir: ws.preparedDir,
    state: await openState(ws.stateFile), report: statusReporter(fake.convex),
    alert: async (t) => (alerts.push(t), true), uploadUrl: server!.uploadUrl, sleep: async (ms) => void sleeps.push(ms),
    exit: (code) => void exits.push(code),
  });
  return { ws, items, fake, logs, alerts, sleeps, exits, deps, srv: server };
}
const results = (calls: Array<[string, ...unknown[]]>) => calls.filter((c) => c[0] === "result").map((c) => c[2]);
const statuses = (calls: Array<[string, ...unknown[]]>) => calls.filter((c) => c[0] === "setMixcloud").map((c) => c[1]);

describe("publishPass: the happy path", () => {
  test("uploads the fields from toMixcloudFields plus mp3 and picture, then records the URL", async () => {
    const s = await setup();
    await publishPass(await s.deps());
    const [up] = s.srv.uploads();
    expect(s.srv.uploads()).toHaveLength(1);
    expect(up!.method).toBe("POST");
    expect(up!.query.get("access_token")).toBe(ACCESS_TOKEN);
    const form = up!.form!;
    // multipart/form-data sends line breaks as CRLF (the HTML encoding rules); Mixcloud gets the same text.
    const text = Object.fromEntries([...form.entries()].flatMap(([k, v]) => (typeof v === "string" ? [[k, v.replaceAll("\r\n", "\n")]] : [])));
    expect(text).toEqual(toMixcloudFields(s.items[0]!.draft));
    // Hard Rule 11: every text field is a name, description, tag or section artist/song; nothing else (no times).
    for (const k of Object.keys(text)) expect(k).toMatch(/^(?:name|description|tags-\d+-tag|sections-\d+-(?:artist|song))$/);
    expect(Object.keys(text).filter((k) => k.startsWith("sections-")).length).toBe(31 * 2);
    expect(form.has("unlisted")).toBe(false);
    const mp3 = form.get("mp3") as File;
    const picture = form.get("picture") as File;
    expect(sha256(Buffer.from(await mp3.arrayBuffer()))).toBe(sha256(s.ws.mp3));
    expect(Buffer.from(await picture.arrayBuffer()).equals(JPEG)).toBe(true);
    expect(picture.type).toBe("image/jpeg");
    expect(s.fake.names()).toEqual(["queue", "claim", "coverUrl", "result", "setMixcloud"]);
    expect(results(s.fake.calls)).toEqual([{ status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/rhythm-lab-radio-10-2-26/" }]);
    expect(statuses(s.fake.calls)).toEqual([{ state: "connected", account: "rhythmlab", connectedAt: 1_761_000_000_000 }]);
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("succeeded");
  });

  test("the real upload URL is Mixcloud's", () => {
    expect(MIXCLOUD_UPLOAD_URL).toBe(`https://api.${"mixcloud"}.com/${"upload"}/`);
  });

  test("oldest show first; a coverless package is skipped (never claimed) and reported as no_cover", async () => {
    const s = await setup({ items: 2 });
    s.items[0]!.coverStorageId = undefined; // the older show has no cover at all
    await publishPass(await s.deps());
    expect(s.fake.calls.filter((c) => c[0] === "claim")).toEqual([["claim", s.items[1]!.packageId]]);
    expect(statuses(s.fake.calls)).toEqual([{ state: "connected", account: "rhythmlab", connectedAt: 1_761_000_000_000, lastError: "no_cover" }]);
  });

  test("only a coverless package: no claim, no upload", async () => {
    const s = await setup({ noCover: true });
    await publishPass(await s.deps());
    expect(s.fake.names()).toEqual(["queue", "setMixcloud"]);
    expect(s.srv.uploads()).toHaveLength(0);
  });
});

describe("publishPass: refusals before any request is sent", () => {
  test("hash mismatch: failed 'audio changed since approval', no upload request", async () => {
    const s = await setup();
    await s.ws.addMp3(s.items[0]!.packageId, randomBytes(1000));
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(0);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "audio changed since approval" }]);
  });

  test("missing MP3: failed, no upload", async () => {
    const s = await setup();
    await rm(join(s.ws.preparedDir, `${s.items[0]!.packageId}.mp3`));
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(0);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "audio file missing" }]);
  });

  test.each([
    ["not an image", Buffer.from("<html>nope</html>")],
    ["over 10 MB", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(10 * 1024 ** 2)])],
  ])("cover %s: failed 'cover is not a usable image', no upload", async (_n, cover) => {
    const s = await setup({ cover });
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(0);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "cover is not a usable image" }]);
  });

  test("validateForUpload problems: failed with them, no upload", async () => {
    const s = await setup();
    s.items[0]!.draft = { ...s.items[0]!.draft, title: "x".repeat(101) };
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(0);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "The title is 101 characters; Mixcloud allows 100" }]);
  });

  test("a package id that is not a plain name is refused, no file is read", async () => {
    const s = await setup();
    s.fake.status.set("../../etc/x", "approved");
    s.items[0]!.packageId = "../../etc/x";
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(0);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "bad package id" }]);
  });
});

describe("publishPass: Mixcloud's answers (R23)", () => {
  const INVALID = { error: { message: "An invalid access token was provided", type: "OAuthException" } };

  test("invalid token: needs_reconnect, unclaim back to approved, one alert, and no loop", async () => {
    const s = await setup({ upload: [recordUpload(401, INVALID), okUpload] });
    const deps = await s.deps();
    await publishPass(deps);
    const id = s.items[0]!.packageId;
    expect(s.fake.status.get(id)).toBe("approved");
    expect(s.fake.calls.filter((c) => c[0] === "unclaim")).toEqual([["unclaim", id]]);
    expect(results(s.fake.calls)).toEqual([]);
    expect(statuses(s.fake.calls)).toEqual([{ state: "needs_reconnect", account: "rhythmlab", connectedAt: 1_761_000_000_000, lastError: "invalid_token" }]);
    expect(s.alerts).toEqual(["Mixcloud needs reconnecting: open Settings"]);
    for (let i = 0; i < 3; i++) await publishPass(deps);
    // A restart (fresh memory, same state file) does not try the refused key again either.
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(1);
    expect(s.alerts).toHaveLength(1);
    expect(s.fake.calls.filter((c) => c[0] === "claim")).toHaveLength(1);
    // Reconnecting writes a new key: the package goes up.
    await s.ws.writeToken("a-brand-new-access-token-0987654321");
    await publishPass(deps);
    expect(s.srv.uploads()).toHaveLength(2);
    expect(s.fake.status.get(id)).toBe("succeeded");
  });

  test("a Reconnect that hands back the same key (new connectedAt) is tried again", async () => {
    const s = await setup({ upload: [recordUpload(401, INVALID), okUpload] });
    const deps = await s.deps();
    await publishPass(deps);
    await publishPass(deps);
    expect(s.srv.uploadRequests()).toBe(1);
    await writeFile(s.ws.tokenFile, JSON.stringify({ access_token: ACCESS_TOKEN, account: "rhythmlab", connectedAt: 1_762_000_000_000 }));
    await publishPass(deps);
    expect(s.srv.uploadRequests()).toBe(2);
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("succeeded");
  });

  test("an OAuthException type alone, or the message alone, is an invalid token", async () => {
    for (const body of [{ error: { type: "OAuthException", message: "other" } }, { error: { message: "An invalid access token was provided" } }]) {
      const s = await setup({ upload: [recordUpload(403, body)] });
      await publishPass(await s.deps());
      expect(s.fake.calls.filter((c) => c[0] === "unclaim")).toHaveLength(1);
      await s.srv.close();
      server = undefined;
    }
  });

  test("403 with Retry-After: waits that long and retries exactly once", async () => {
    const limited = recordUpload(403, { error: { type: "RateLimitException", message: "slow down" } }, { "retry-after": "7" });
    const s = await setup({ upload: [limited, okUpload] });
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(2);
    expect(s.sleeps).toEqual([7000]);
    expect(results(s.fake.calls)).toEqual([{ status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/rhythm-lab-radio-10-2-26/" }]);
  });

  test("a second rate limit: failed rate_limited (it was refused, so not unknown), no third try", async () => {
    const limited = recordUpload(403, { error: { type: "RateLimitException" } }, { "retry-after": "2" });
    const s = await setup({ upload: [limited] });
    await publishPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(2);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "rate_limited" }]);
    expect(statuses(s.fake.calls).at(-1)).toMatchObject({ state: "connected", lastError: "rate_limited" });
  });

  test("another 4xx with a JSON error: failed with a short code", async () => {
    const s = await setup({ upload: [recordUpload(400, { error: { type: "UploadLimitExceeded", message: "free text from Mixcloud" } })] });
    await publishPass(await s.deps());
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "UploadLimitExceeded" }]);
  });

  test.each([
    ["a 500", recordUpload(500, { error: "boom" })],
    ["a 200 that is not JSON", async (req: Parameters<typeof readBody>[0], res: import("node:http").ServerResponse) => { await readBody(req); res.end("<html>ok</html>"); }],
    ["a 200 without success", recordUpload(200, { result: { success: false } })],
    ["a key that is not a path", recordUpload(200, { result: { success: true, key: "@evil.example/x" } })],
  ])("%s: outcome_unknown, never retried", async (_n, handler) => {
    const s = await setup({ upload: [handler as never, okUpload] });
    const deps = await s.deps();
    await publishPass(deps);
    await publishPass(deps);
    expect(s.srv.uploadRequests()).toBe(1);
    expect(results(s.fake.calls)).toEqual([{ status: "outcome_unknown" }]);
  });

  test("the connection drops mid-body: outcome_unknown, and no second upload ever", async () => {
    const drop = async (req: import("node:http").IncomingMessage) => {
      let got = 0;
      req.on("data", (c: Buffer) => {
        got += c.length;
        if (got > 64 * 1024) req.socket.destroy();
      });
    };
    const s = await setup({ upload: [drop, okUpload] });
    const deps = await s.deps();
    await publishPass(deps);
    expect(results(s.fake.calls)).toEqual([{ status: "outcome_unknown" }]);
    for (let i = 0; i < 3; i++) await publishPass(deps);
    expect(s.srv.uploadRequests()).toBe(1);
  });

  test("Mixcloud never answers: the upload times out as outcome_unknown", async () => {
    const hang = async (req: import("node:http").IncomingMessage) => void (await readBody(req));
    const s = await setup({ upload: [hang] });
    await publishPass({ ...(await s.deps()), uploadTimeoutMs: 300 });
    expect(results(s.fake.calls)).toEqual([{ status: "outcome_unknown" }]);
  });
});

describe("Hard Rule 9: the publisher re-checks the workspace", () => {
  test("a demo package in the queue is skipped (logged skip_demo), never claimed; the real one goes up", async () => {
    const s = await setup({ items: 2 });
    s.items[0]!.draft = { ...s.items[0]!.draft, workspace: "demo" }; // the older one, so it would be picked first
    await publishPass(await s.deps());
    expect(s.fake.calls.filter((c) => c[0] === "claim")).toEqual([["claim", s.items[1]!.packageId]]);
    expect(s.logs).toContain(`publish package=${s.items[0]!.packageId} step=skip_demo ok=false ms=0`);
    expect(s.srv.uploadRequests()).toBe(1);
  });

  test("only a demo package: nothing claimed, nothing uploaded", async () => {
    const s = await setup();
    s.items[0]!.draft = { ...s.items[0]!.draft, workspace: "demo" };
    await publishPass(await s.deps());
    expect(s.fake.calls.filter((c) => c[0] === "claim")).toEqual([]);
    expect(s.srv.uploadRequests()).toBe(0);
  });
});

describe("after the claim, a package never stays publishing", () => {
  const failing = (fn: (...a: never[]) => Promise<void>, times: number, error = "network timeout") => {
    let left = times;
    return async (...a: never[]) => {
      if (left-- > 0) throw new Error(error);
      return fn(...a);
    };
  };

  test("result fails once after a 200: retried after 1 s, succeeded recorded with the URL, no second upload", async () => {
    const s = await setup();
    s.fake.convex.result = failing(s.fake.convex.result as never, 1);
    await publishPass(await s.deps());
    expect(s.srv.uploadRequests()).toBe(1);
    expect(s.sleeps).toEqual([1000]);
    expect(results(s.fake.calls)).toEqual([{ status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/rhythm-lab-radio-10-2-26/" }]);
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("succeeded");
    expect(s.exits).toEqual([]);
  });

  test("result fails 5 times: step=record ok=false and the process exits non-zero; no second upload", async () => {
    const s = await setup();
    s.fake.convex.result = failing(s.fake.convex.result as never, 99);
    const deps = await s.deps();
    await publishPass(deps);
    expect(s.sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(s.exits).toEqual([1]);
    expect(s.logs).toContain(`publish package=${s.items[0]!.packageId} step=record ok=false ms=0`);
    await publishPass(deps); // still publishing, so never queued again; the restart's reconcile settles it
    expect(s.srv.uploadRequests()).toBe(1);
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("publishing");
  });

  test("NOT_READY from result means an earlier attempt landed: done, no exit", async () => {
    const s = await setup();
    const real = s.fake.convex.result;
    let first = true;
    s.fake.convex.result = async (id, r) => {
      await real(id, r); // the write lands, but the first answer is lost; the retry then gets NOT_READY
      if (first) { first = false; throw new Error("answer lost"); }
    };
    await publishPass(await s.deps());
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("succeeded");
    expect(s.sleeps).toEqual([1000]);
    expect(s.exits).toEqual([]);
  });

  test("unclaim throws once: retried, and the package is back to approved", async () => {
    const s = await setup({ upload: [recordUpload(401, { error: { type: "OAuthException" } })] });
    s.fake.convex.unclaim = failing(s.fake.convex.unclaim as never, 1);
    await publishPass(await s.deps());
    expect(s.fake.calls.filter((c) => c[0] === "unclaim")).toHaveLength(1);
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("approved");
    expect(s.exits).toEqual([]);
  });

  test("saving the refused key fails: the package is still unclaimed", async () => {
    const s = await setup({ upload: [recordUpload(401, { error: { type: "OAuthException" } })] });
    const deps = await s.deps();
    await publishPass({ ...deps, state: { get: deps.state.get, update: async () => { throw new Error("disk full"); } } });
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("approved");
  });

  test("an unexpected throw before the request is sent: failed internal_error, no upload", async () => {
    const s = await setup();
    s.items[0]!.draft = { ...s.items[0]!.draft, tracks: undefined as never };
    await publishPass(await s.deps());
    expect(s.srv.uploadRequests()).toBe(0);
    expect(results(s.fake.calls)).toEqual([{ status: "failed", error: "internal_error" }]);
  });

  test("an unexpected throw after the request started: outcome_unknown, never retried", async () => {
    const limited = recordUpload(403, { error: { type: "RateLimitException" } }, { "retry-after": "1" });
    const s = await setup({ upload: [limited, okUpload] });
    const deps = await s.deps();
    await publishPass({ ...deps, sleep: async () => { throw new Error("unexpected"); } });
    await publishPass(deps);
    expect(s.srv.uploadRequests()).toBe(1);
    expect(results(s.fake.calls)).toEqual([{ status: "outcome_unknown" }]);
  });
});

describe("pacing and restarts", () => {
  test("the 4th approval in a Chicago day is not uploaded", async () => {
    const s = await setup({ publishedToday: 3 });
    await publishPass(await s.deps());
    expect(s.fake.calls.filter((c) => c[0] === "claim")).toEqual([]);
    expect(s.srv.uploads()).toHaveLength(0);
  });

  test("startup reconciles exactly once (a package left publishing becomes outcome_unknown); the loop never does", async () => {
    const s = await setup();
    const id = s.items[0]!.packageId;
    s.fake.status.set(id, "publishing"); // the last run died mid-upload
    const deps = await s.deps();
    await startup(deps);
    expect(s.fake.names().slice(0, 1)).toEqual(["reconcile"]);
    expect(s.fake.status.get(id)).toBe("outcome_unknown");
    for (let i = 0; i < 3; i++) await publishPass(deps);
    expect(s.fake.names().filter((n) => n === "reconcile")).toHaveLength(1);
    expect(s.srv.uploads()).toHaveLength(0);
  });

  test("startup reports the token file's state once, so a stale status row is corrected", async () => {
    const s = await setup();
    await startup(await s.deps());
    expect(statuses(s.fake.calls)).toEqual([{ state: "connected", account: "rhythmlab", connectedAt: 1_761_000_000_000 }]);
    await rm(s.ws.tokenFile);
    const fresh = await s.deps();
    await startup(fresh);
    expect(statuses(s.fake.calls).at(-1)).toEqual({ state: "not_connected", lastError: "no_token" });
  });
});

describe("the token file", () => {
  test("missing: not_connected, nothing claimed; reported once, not every pass", async () => {
    const s = await setup();
    await rm(s.ws.tokenFile);
    const deps = await s.deps();
    await publishPass(deps);
    await publishPass(deps);
    expect(statuses(s.fake.calls)).toEqual([{ state: "not_connected", lastError: "no_token" }]);
    expect(s.fake.calls.filter((c) => c[0] === "claim")).toEqual([]);
  });

  test.each([["empty", ""], ["half written", '{"access_tok'], ["no access_token", '{"account":"rhythmlab"}'], ["empty access_token", '{"access_token":""}']])(
    "%s: needs_reconnect invalid_token_file, nothing claimed",
    async (_n, content) => {
      const s = await setup();
      await writeFile(s.ws.tokenFile, content);
      await publishPass(await s.deps());
      expect(statuses(s.fake.calls)).toEqual([{ state: "needs_reconnect", lastError: "invalid_token_file" }]);
      expect(s.fake.calls.filter((c) => c[0] === "claim")).toEqual([]);
    },
  );
});

describe("Hard Rule 8: logs", () => {
  test("only `publish package=<id> step=<step> ok=<bool> ms=<n>`; never the token, title, URL or a path", async () => {
    const s = await setup({ upload: [recordUpload(401, { error: { type: "OAuthException" } })] });
    await startup(await s.deps());
    await publishPass(await s.deps());
    await s.ws.writeToken("second-SECRET-token-abcdefghijkl");
    await publishPass(await s.deps());
    expect(s.logs.length).toBeGreaterThan(4);
    for (const line of s.logs) expect(line).toMatch(/^publish package=[\w-]+ step=\w+ ok=(?:true|false) ms=\d+$/);
    const all = s.logs.join("\n");
    for (const secret of [ACCESS_TOKEN, "second-SECRET", "SECRET", s.items[0]!.draft.title, "http", s.ws.dir]) expect(all).not.toContain(secret);
  });
});

describe("--unlisted-test (R8)", () => {
  test("uploads the approved package once with unlisted=1 and returns only the URL; never claims, records, reconciles or reports", async () => {
    const s = await setup();
    const out = await unlistedTest(await s.deps(), s.items[0]!.packageId);
    expect(out).toBe("https://www.mixcloud.com/rhythmlab/rhythm-lab-radio-10-2-26/");
    expect(s.srv.uploads()).toHaveLength(1);
    expect(s.srv.uploads()[0]!.form!.get("unlisted")).toBe("1");
    expect(s.fake.names()).toEqual(["queue", "coverUrl"]);
    expect(s.fake.status.get(s.items[0]!.packageId)).toBe("approved");
  });

  test("Hard Rule 9: a demo package is refused, nothing uploaded", async () => {
    const s = await setup();
    s.items[0]!.draft = { ...s.items[0]!.draft, workspace: "demo" };
    expect(await unlistedTest(await s.deps(), s.items[0]!.packageId)).toBe("demo_cannot_publish");
    expect(s.srv.uploadRequests()).toBe(0);
    expect(s.fake.names()).toEqual(["queue"]);
  });

  test("refuses an id that is not in the approved queue", async () => {
    const s = await setup();
    expect(await unlistedTest(await s.deps(), "pkg-not-approved")).toBe("not_in_queue");
    expect(s.srv.uploads()).toHaveLength(0);
    expect(s.fake.names()).toEqual(["queue"]);
  });

  test("an error comes back as a code, still without touching package state", async () => {
    const s = await setup({ upload: [recordUpload(401, { error: { type: "OAuthException" } })] });
    expect(await unlistedTest(await s.deps(), s.items[0]!.packageId)).toBe("invalid_token");
    expect(s.fake.names()).toEqual(["queue", "coverUrl"]);
  });
});

test("state file survives as JSON", async () => {
  const s = await setup({ upload: [recordUpload(401, { error: { type: "OAuthException" } })] });
  await publishPass(await s.deps());
  const saved = JSON.parse(await readFile(s.ws.stateFile, "utf8"));
  expect(saved.rejectedToken).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(saved)).not.toContain(ACCESS_TOKEN);
});
