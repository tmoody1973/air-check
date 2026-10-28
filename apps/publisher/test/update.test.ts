import { rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import type { UpdateClaim } from "../src/convex.js";
import { MIXCLOUD_UPLOAD_URL, showEditUrl } from "../src/mixcloud.js";
import { fullPass, statusReporter, updatePass, type PublishDeps } from "../src/publish.js";
import { openState } from "../src/state.js";
import { ACCESS_TOKEN, fakeConvex, fakeServer, queueItem, recordUpload, workspace } from "./helpers.js";

// Plan 5c Task 4: the publisher pushes an approved description update to a show already on Mixcloud, through
// Mixcloud's edit endpoint, with only the description field.
type Server = Awaited<ReturnType<typeof fakeServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const SHOW = "https://www.mixcloud.com/rhythmlab/rlr-10226-tinashe/";
const TEXT = "Warm, patient soul for a grey morning.\nSecond hour leans into Afrobeat.";
const update = (over: Partial<UpdateClaim> = {}): UpdateClaim => ({ id: "upd1", packageId: "pkg-10-2-26", description: TEXT, showUrl: SHOW, ...over });
const INVALID = { error: { message: "An invalid access token was provided", type: "OAuthException" } };

async function setup(opts: { edit?: NonNullable<Parameters<typeof fakeServer>[0]>["edit"]; updates?: UpdateClaim[]; publishedToday?: number; packages?: boolean } = {}) {
  server = await fakeServer({ edit: opts.edit });
  const ws = await workspace();
  const items = opts.packages ? [queueItem(ws.mp3)] : [];
  for (const p of items) await ws.addMp3(p.packageId);
  const fake = fakeConvex(items, { updates: opts.updates ?? [update()], publishedToday: opts.publishedToday, coverBase: server.base });
  const logs: string[] = [];
  const alerts: string[] = [];
  const exits: number[] = [];
  const deps = async (): Promise<PublishDeps> => ({
    convex: fake.convex, log: (l) => logs.push(l), tokenFile: ws.tokenFile, preparedDir: ws.preparedDir,
    state: await openState(ws.stateFile), report: statusReporter(fake.convex),
    alert: async (t) => (alerts.push(t), true), uploadUrl: server!.uploadUrl, sleep: async () => {}, exit: (code) => void exits.push(code),
  });
  return { ws, fake, logs, alerts, exits, deps, srv: server };
}
const recorded = (calls: Array<[string, ...unknown[]]>) => calls.filter((c) => c[0] === "recordUpdate").map((c) => c[2]);

describe("the edit URL comes only from the package's own receipt", () => {
  test("https://www.mixcloud.com/<user>/<slug>/ becomes Mixcloud's /upload/<user>/<slug>/edit/", () => {
    expect(showEditUrl(SHOW)).toBe(`${MIXCLOUD_UPLOAD_URL}rhythmlab/rlr-10226-tinashe/edit/`);
    expect(showEditUrl(SHOW, "http://127.0.0.1:9/upload/")).toBe("http://127.0.0.1:9/upload/rhythmlab/rlr-10226-tinashe/edit/");
  });

  test.each([
    "http://www.mixcloud.com/rhythmlab/x/", "https://mixcloud.com/rhythmlab/x/", "https://www.mixcloud.com.evil.example/rhythmlab/x/",
    "https://www.mixcloud.com/rhythmlab/x", "https://www.mixcloud.com/rhythmlab/", "https://www.mixcloud.com/a/b/c/",
    "https://www.mixcloud.com/rhythmlab/../upload/", "https://www.mixcloud.com/rhythmlab/x%2F..%2F/", "https://www.mixcloud.com/rhythmlab/x/?a=1",
    "https://www.mixcloud.com/rhythmlab/x/#y", "https://user@www.mixcloud.com/rhythmlab/x/", "https://www.mixcloud.com:444/rhythmlab/x/", "", " https://www.mixcloud.com/rhythmlab/x/",
  ])("refused: %j", (url) => {
    expect(showEditUrl(url)).toBeNull();
  });

  test("a bad receipt URL fails the update with bad_show_url and sends nothing", async () => {
    const s = await setup({ updates: [update({ showUrl: "https://www.mixcloud.com.evil.example/rhythmlab/x/" })] });
    await updatePass(await s.deps());
    expect(s.srv.editRequests()).toBe(0);
    expect(recorded(s.fake.calls)).toEqual([{ status: "failed", error: "bad_show_url" }]);
  });
});

describe("updatePass", () => {
  test("posts only `description` to the show's edit URL with the token, then records pushed", async () => {
    const s = await setup();
    await updatePass(await s.deps());
    const [edit] = s.srv.edits();
    expect(s.srv.edits()).toHaveLength(1);
    expect(edit!.method).toBe("POST");
    expect(edit!.path).toBe("/upload/rhythmlab/rlr-10226-tinashe/edit/");
    expect(edit!.query.get("access_token")).toBe(ACCESS_TOKEN);
    // Name, picture, tags, sections and hosts are only changed when posted: post nothing but the description.
    const entries = [...edit!.form!.entries()];
    expect(entries.map(([k]) => k)).toEqual(["description"]);
    expect(String(entries[0]![1]).replaceAll("\r\n", "\n")).toBe(TEXT);
    expect(s.fake.names()).toEqual(["claimUpdate", "recordUpdate"]);
    expect(recorded(s.fake.calls)).toEqual([{ status: "pushed" }]);
  });

  test("nothing approved: one claim, no request", async () => {
    const s = await setup({ updates: [] });
    await updatePass(await s.deps());
    expect(s.fake.names()).toEqual(["claimUpdate"]);
    expect(s.srv.editRequests()).toBe(0);
    expect(s.logs).toEqual([]); // an idle pass every 30 s writes no log line
  });

  test("no token file: nothing is claimed", async () => {
    const s = await setup();
    await rm(s.ws.tokenFile);
    await updatePass(await s.deps());
    expect(s.fake.names()).not.toContain("claimUpdate");
  });

  test("invalid token: needs_reconnect, back to approved, one alert, and the refused key is never tried again", async () => {
    const s = await setup({ edit: [recordUpload(401, INVALID), recordUpload(200, { result: { success: true } })] });
    const deps = await s.deps();
    await updatePass(deps);
    expect(recorded(s.fake.calls)).toEqual([{ status: "unclaim" }]);
    expect(s.fake.updateStatus.get("upd1")).toBe("approved");
    expect(s.fake.calls.filter((c) => c[0] === "setMixcloud").map((c) => c[1])).toEqual([
      { state: "needs_reconnect", account: "rhythmlab", connectedAt: 1_761_000_000_000, lastError: "invalid_token" },
    ]);
    expect(s.alerts).toEqual(["Mixcloud needs reconnecting: open Settings"]);
    for (let i = 0; i < 3; i++) await updatePass(deps);
    await updatePass(await s.deps()); // a restart reads the same state file
    expect(s.srv.editRequests()).toBe(1);
    expect(s.fake.calls.filter((c) => c[0] === "claimUpdate")).toHaveLength(1);
    await s.ws.writeToken("a-brand-new-access-token-0987654321");
    await updatePass(deps);
    expect(s.fake.updateStatus.get("upd1")).toBe("pushed");
  });

  test.each([
    ["a rate limit (403 + Retry-After)", recordUpload(403, { error: { type: "RateLimitException" } }, { "retry-after": "30" })],
    ["a 500", recordUpload(500, {})],
    ["a 429", recordUpload(429, {})],
    ["a 200 without success", recordUpload(200, { result: { success: false } })],
    ["a 200 that is not JSON", recordUpload(200, "<html>")],
    ["a dropped connection", async (req: IncomingMessage, res: ServerResponse) => { req.resume(); res.destroy(); }],
  ] as const)("%s: retry (back to approved for the next pass; Convex counts the try), nothing waited for", async (_name, handler) => {
    const s = await setup({ edit: [handler as never] });
    await updatePass(await s.deps());
    expect(recorded(s.fake.calls)).toEqual([{ status: "retry" }]);
    expect(s.fake.updateStatus.get("upd1")).toBe("approved");
  });

  test("another 4xx: failed with a short code, never Mixcloud's free text", async () => {
    const s = await setup({ edit: [recordUpload(404, { error: { type: "NotFound", message: "No cloudcast <script>" } })] });
    await updatePass(await s.deps());
    expect(recorded(s.fake.calls)).toEqual([{ status: "failed", error: "NotFound" }]);
    const t = await setup({ edit: [recordUpload(400, { error: { message: "too long" } })] });
    await updatePass(await t.deps());
    expect(recorded(t.fake.calls)).toEqual([{ status: "failed", error: "http_400" }]);
  });

  test("the record write fails once: retried, and recorded once; NOT_READY means an earlier one landed", async () => {
    const s = await setup();
    const real = s.fake.convex.recordUpdate;
    let n = 0;
    s.fake.convex.recordUpdate = async (id, o) => {
      if (n++ === 0) throw new Error("network");
      return real(id, o);
    };
    await updatePass(await s.deps());
    expect(s.fake.updateStatus.get("upd1")).toBe("pushed");
    expect(s.srv.editRequests()).toBe(1);
    expect(s.exits).toEqual([]);
  });

  test("updates ignore the 3-a-day publish limit", async () => {
    const s = await setup({ packages: true, publishedToday: 3 });
    await fullPass(await s.deps());
    expect(s.srv.uploads()).toHaveLength(0);
    expect(s.fake.updateStatus.get("upd1")).toBe("pushed");
  });

  test("one pass runs the publish step, then the update step, even when the publish step throws", async () => {
    const s = await setup({ packages: true });
    s.fake.convex.queue = async () => { throw new Error("convex down"); };
    await expect(fullPass(await s.deps())).rejects.toThrow("convex down");
    expect(s.fake.updateStatus.get("upd1")).toBe("pushed");
  });
});

describe("Hard Rule 8: update logs", () => {
  test("only `publish update=<id> package=<id> step=<step> ok=<bool> ms=<n>`; never the text, token or URL", async () => {
    const s = await setup({ edit: [recordUpload(401, INVALID)] });
    await updatePass(await s.deps());
    await s.ws.writeToken("second-SECRET-token-abcdefghijkl");
    await updatePass(await s.deps());
    expect(s.logs.length).toBeGreaterThan(3);
    for (const line of s.logs) expect(line).toMatch(/^publish update=\w+ package=[\w-]+ step=\w+ ok=(?:true|false) ms=\d+$/);
    const all = s.logs.join("\n");
    for (const secret of [ACCESS_TOKEN, "SECRET", "Warm", "http", "mixcloud", s.ws.dir]) expect(all).not.toContain(secret);
  });
});
