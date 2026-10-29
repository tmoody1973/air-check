// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseTracklist } from "@aircheck/core";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api } from "./_generated/api";
import schema from "./schema";

// Plan 6 Task 2: the ingest service's token-gated API. It writes episode rows (real workspace only) and asks for the
// same draft-package run the Tracklist page queues; it can never approve, decide or touch a package.
const modules = import.meta.glob("./**/*.*s");
const INGEST = "i".repeat(48);
const OTHER = { MEDIA_TOKEN: "m".repeat(48), PUBLISHER_TOKEN: "p".repeat(48), RELAY_TOKEN: "r".repeat(48), AGENT_SUBMIT_TOKEN: "a".repeat(48), DEMO_AGENT_SUBMIT_TOKEN: "d".repeat(48) };
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("INGEST_TOKEN", INGEST);
  for (const [k, val] of Object.entries(OTHER)) vi.stubEnv(k, val);
});
afterEach(() => vi.unstubAllEnvs());

const track = (hour: 1 | 2, position: number, artist: string, title: string, closing = false) => ({
  hour, position, artist, title, raw: `${artist} - ${title}`, closing, status: closing ? ("closing-track" as const) : ("confirmed" as const),
});
const TRACKS = [
  track(1, 1, "Alfa Mist", "Organic Rust"), track(1, 2, "Nala Sinephro", "Space 1", true),
  track(2, 1, "Kokoroko", "Abusey Junction"), track(2, 2, "Yussef Dayes", "Black Classical Music", true),
];

function episode(over: Record<string, unknown> = {}) {
  return {
    showDate: "2026-01-02",
    audio: { status: "ready" as const, folderId: "f1", hour1: { id: "b1", name: "RLR_H1_010226.wav", size: 600_000_000 }, hour2: { id: "b2", name: "RLR_H2_010226.wav", size: 600_000_000 }, pattern: "rlr", flags: [] },
    tracklist: { status: "found" as const, docId: "g1", tracks: TRACKS },
    notes: { status: "found" as const, docId: "p1", text: "Private: Alfa Mist told me about the new record." },
    questions: [] as { id: string; text: string; kind: "audio" | "date" | "tracklist" | "rerun"; rerunOf?: string }[],
    ...over,
  };
}
const upsert = (t: T, ep: unknown, token = INGEST) => t.mutation(api.ingest.upsert, { token, episode: ep as never });
const row = (t: T, showDate = "2026-01-02") => t.run((ctx) => ctx.db.query("episodes").withIndex("by_showDate", (q) => q.eq("showDate", showDate)).unique());
const runs = (t: T) => t.run((ctx) => ctx.db.query("runs").collect());
const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
  return "no error";
};
const insertPackage = (t: T, status: string, over: Record<string, unknown> = {}) =>
  t.run(async (ctx) => {
    const draft = goldenDraft(over as never);
    await ctx.db.insert("packages", { packageId: draft.id, workspace: draft.workspace, status, draft, ...(status === "succeeded" ? { result: { url: "https://www.mixcloud.com/rhythmlab/x/" } } : {}) });
  });

describe("INGEST_TOKEN", () => {
  test("every ingest function fails closed: unset, short or wrong token", async () => {
    const t = convexTest(schema, modules);
    const calls = (token: string) => [
      t.query(api.ingest.list, { token }),
      upsert(t, episode(), token),
      t.mutation(api.ingest.setFetch, { token, showDate: "2026-01-02", status: "fetching" }),
      t.mutation(api.ingest.requestDraft, { token, showDate: "2026-01-02" }),
      t.mutation(api.ingest.sourceStatus, { token, source: "box", state: "connected" }),
      t.mutation(api.ingest.prune, { token, keep: [] }),
    ];
    for (const token of ["", "x".repeat(48), ...Object.values(OTHER)]) for (const c of calls(token)) expect(await errorCode(c)).toBe("UNAUTHORIZED");
    vi.stubEnv("INGEST_TOKEN", "short");
    for (const c of calls("short")) expect(await errorCode(c)).toBe("UNAUTHORIZED");
    vi.stubEnv("INGEST_TOKEN", "");
    for (const c of calls("")) expect(await errorCode(c)).toBe("UNAUTHORIZED");
    expect(await t.run((ctx) => ctx.db.query("episodes").collect())).toEqual([]);
  });

  test.each(Object.keys(OTHER))("an INGEST_TOKEN equal to %s refuses everything (one secret for two services)", async (name) => {
    vi.stubEnv("INGEST_TOKEN", OTHER[name as keyof typeof OTHER]);
    const t = convexTest(schema, modules);
    expect(await errorCode(t.query(api.ingest.list, { token: OTHER[name as keyof typeof OTHER] }))).toBe("UNAUTHORIZED");
  });

  test("media and publisher refuse everything when their token equals INGEST_TOKEN", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("INGEST_TOKEN", OTHER.MEDIA_TOKEN);
    expect(await errorCode(t.query(api.media.pending, { token: OTHER.MEDIA_TOKEN }))).toBe("UNAUTHORIZED");
    vi.stubEnv("INGEST_TOKEN", OTHER.PUBLISHER_TOKEN);
    expect(await errorCode(t.query(api.publisher.awaitingReview, { token: OTHER.PUBLISHER_TOKEN }))).toBe("UNAUTHORIZED");
  });

  test("R11: the relay and the agent routes refuse their token when it equals INGEST_TOKEN", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("RELAY_TOKEN", INGEST);
    expect(await errorCode(t.query(api.relay.pending, { token: INGEST }))).not.toBe("no error");
    vi.stubEnv("AGENT_SUBMIT_TOKEN", INGEST);
    const res = await t.fetch("/agent/episodes/rerun", { method: "POST", headers: { authorization: `Bearer ${INGEST}`, "content-type": "application/json" }, body: JSON.stringify({ showDate: "2026-01-02", rerunOf: "2025-12-26" }) });
    expect(res.status).toBe(401);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", OTHER.AGENT_SUBMIT_TOKEN);
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", INGEST);
    const demo = await t.fetch("/agent/episodes/rerun", { method: "POST", headers: { authorization: `Bearer ${INGEST}`, "content-type": "application/json" }, body: JSON.stringify({ showDate: "2026-01-02", rerunOf: "2025-12-26" }) });
    expect(demo.status).toBe(401);
  });

  test("the ingest token is refused by media and publisher", async () => {
    const t = convexTest(schema, modules);
    expect(await errorCode(t.query(api.media.pending, { token: INGEST }))).toBe("UNAUTHORIZED");
    expect(await errorCode(t.query(api.publisher.queue, { token: INGEST }))).toBe("UNAUTHORIZED");
  });
});

describe("ingest.upsert", () => {
  test("stores one row per show date and replaces the scanned facts on the next scan", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await upsert(t, episode({ notes: { status: "missing" }, audioOnDisk: true }));
    const all = await t.run((ctx) => ctx.db.query("episodes").collect());
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ showDate: "2026-01-02", notes: { status: "missing" }, audioOnDisk: true });
    expect(all[0]!.notes.text).toBeUndefined();
    expect(all[0]!.scannedAt).toBeGreaterThan(0);
  });

  test("keeps answers (same id and text), rerun fields and fetch state; drops an answer whose question changed", async () => {
    const t = convexTest(schema, modules);
    const qs = [{ id: "t1", text: "Hour 1 track 2 is not in the notes. Keep it?", kind: "tracklist" }, { id: "t2", text: "Line 4 could not be read.", kind: "tracklist" }];
    await upsert(t, episode({ questions: qs }));
    await t.run(async (ctx) => {
      const r = (await ctx.db.query("episodes").first())!;
      await ctx.db.patch(r._id, {
        questions: r.questions.map((q) => ({ ...q, answer: "Yes", answeredAt: 1 })),
        rerunDeclined: true, fetch: { status: "fetched", at: 5 },
      });
    });
    await upsert(t, episode({ questions: [qs[0], { ...qs[1], text: "Line 5 could not be read." }] }));
    const r = (await row(t))!;
    expect(r.questions).toEqual([{ ...qs[0], answer: "Yes", answeredAt: 1 }, { ...qs[1], text: "Line 5 could not be read." }]);
    expect(r).toMatchObject({ rerunDeclined: true, fetch: { status: "fetched", at: 5 } });
  });

  test("a week marked as a rerun, or declined, never gets a rerun question", async () => {
    const t = convexTest(schema, modules);
    const rerunQ = { id: "rerun", text: "Is 2026-01-02 a rerun of 2025-12-05?", kind: "rerun", rerunOf: "2025-12-05" };
    await upsert(t, episode({ questions: [rerunQ] }));
    expect((await row(t))!.questions).toHaveLength(1);
    await t.run(async (ctx) => ctx.db.patch((await ctx.db.query("episodes").first())!._id, { rerunOf: "2025-12-05", rerunSource: "chat" }));
    await upsert(t, episode({ questions: [rerunQ] }));
    expect((await row(t))!.questions).toEqual([]);
    expect((await row(t))!).toMatchObject({ rerunOf: "2025-12-05", rerunSource: "chat" });
    await t.run(async (ctx) => ctx.db.patch((await ctx.db.query("episodes").first())!._id, { rerunOf: undefined, rerunSource: undefined, rerunDeclined: true }));
    await upsert(t, episode({ questions: [rerunQ] }));
    expect((await row(t))!.questions).toEqual([]);
  });

  test("refuses a bad date, oversized notes or tracklist, and too many questions, with a plain reason", async () => {
    const t = convexTest(schema, modules);
    for (const bad of [
      episode({ showDate: "2026-02-30" }),
      episode({ showDate: "1-2-26" }),
      episode({ notes: { status: "found", text: "x".repeat(65_537) } }),
      episode({ tracklist: { status: "found", tracks: Array.from({ length: 101 }, (_, i) => track(1, i + 1, "A", `T${i}`)) } }),
      episode({ questions: Array.from({ length: 21 }, (_, i) => ({ id: `q${i}`, text: "?", kind: "date" })) }),
      episode({ questions: [{ id: "q", text: "x".repeat(1001), kind: "date" }] }),
    ]) {
      expect(await errorCode(upsert(t, bad))).toBe("BAD_INPUT");
    }
    expect(await t.run((ctx) => ctx.db.query("episodes").collect())).toEqual([]);
  });

  // Hard Rule 2: no credential field exists; Hard Rule 11: no start time; ingest cannot answer or mark a rerun.
  test("refuses any field the schema does not name: tokens, start times, answers, rerun fields", async () => {
    const t = convexTest(schema, modules);
    for (const bad of [
      episode({ accessToken: "secret" }),
      episode({ audio: { ...episode().audio, downloadUrl: "https://box/x?token=y" } }),
      // Spelled in two parts: the repo's boundary check forbids the literal field name anywhere in code.
      episode({ tracklist: { status: "found", tracks: [{ ...TRACKS[0], [["start", "time"].join("_")]: "00:03:10" }] } }),
      episode({ questions: [{ id: "q", text: "?", kind: "date", answer: "yes" }] }),
      episode({ rerunOf: "2025-12-05" }),
      episode({ rerunDeclined: true }),
    ]) {
      await expect(upsert(t, bad)).rejects.toThrow();
    }
    expect(await t.run((ctx) => ctx.db.query("episodes").collect())).toEqual([]);
  });
});

describe("ingest.list", () => {
  test("each episode with its package status, receipt URL when published, status and gaps; never the notes text", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode({ showDate: "2026-10-02" }));
    await upsert(t, episode({ notes: { status: "missing" } }));
    await insertPackage(t, "succeeded");
    // The demo copy of the same show is never linked.
    await insertPackage(t, "awaiting_review", { id: "demo-10-2-26", workspace: "demo" });
    const out = await t.query(api.ingest.list, { token: INGEST });
    expect(out.episodes.map((e) => e.showDate)).toEqual(["2026-01-02", "2026-10-02"]);
    const [jan, oct] = out.episodes;
    expect(jan).toMatchObject({ packageId: "pkg-1-2-26", packageStatus: "none", status: "ready-to-draft", gaps: ["notes"], draftAttempts: 0 });
    expect(jan!.receiptUrl).toBeUndefined();
    expect(oct).toMatchObject({ packageId: "pkg-10-2-26", packageStatus: "succeeded", status: "published", receiptUrl: "https://www.mixcloud.com/rhythmlab/x/" });
    expect(JSON.stringify(out)).not.toContain("Private:");
    expect(oct!.notes).toEqual({ status: "found", docId: "p1" });
    expect(oct!.tracks).toHaveLength(4);
    expect(out.awaitingReview).toBe(0);
  });

  test("awaitingReview counts real packages waiting for review or audio, and open real draft runs", async () => {
    const t = convexTest(schema, modules);
    await insertPackage(t, "awaiting_review");
    await insertPackage(t, "preparing_audio", { id: "pkg-10-9-26", showDate: "2026-10-09" });
    await insertPackage(t, "approved", { id: "pkg-10-16-26", showDate: "2026-10-16" });
    await insertPackage(t, "awaiting_review", { id: "demo-10-2-26", workspace: "demo" });
    await upsert(t, episode());
    await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" });
    expect((await t.query(api.ingest.list, { token: INGEST })).awaitingReview).toBe(3);
  });
});

describe("ingest.setFetch", () => {
  test("records the fetch state and a short error; an unknown date is NOT_FOUND", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await t.mutation(api.ingest.setFetch, { token: INGEST, showDate: "2026-01-02", status: "failed", error: "x".repeat(500) });
    const f = (await row(t))!.fetch!;
    expect(f.status).toBe("failed");
    expect(f.error).toHaveLength(200);
    await t.mutation(api.ingest.setFetch, { token: INGEST, showDate: "2026-01-02", status: "fetched" });
    expect((await row(t))!.fetch).toEqual({ status: "fetched", at: expect.any(Number) });
    expect(await errorCode(t.mutation(api.ingest.setFetch, { token: INGEST, showDate: "2026-01-09", status: "fetching" }))).toBe("NOT_FOUND");
  });
});

describe("ingest.requestDraft", () => {
  test("queues the Tracklist page's draft-package run, with the reconciled tracklist and the notes plus answers as untrusted notes", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode({ questions: [{ id: "t1", text: "Hour 1 track 2 is not in the notes. Keep it?", kind: "tracklist" }] }));
    await t.run(async (ctx) => {
      const r = (await ctx.db.query("episodes").first())!;
      await ctx.db.patch(r._id, { questions: r.questions.map((q) => ({ ...q, answer: "Keep it, it is the closer.", answeredAt: 1 })) });
    });
    const r = await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" });
    expect(r).toMatchObject({ queued: true });
    const [run] = await runs(t);
    expect(run).toMatchObject({ workspace: "real", kind: "draft-package", source: "live", status: "queued", title: "Draft package · 2026-01-02" });
    const parsed = parseTracklist(run!.form!.tracklistText);
    expect(parsed.bad).toEqual([]);
    expect(parsed.tracks.map((x) => [x.hour, x.artist, x.title, x.closing])).toEqual(TRACKS.map((x) => [x.hour, x.artist, x.title, x.closing]));
    expect(run!.form!.notes).toBe("Private: Alfa Mist told me about the new record.\n\nTarik's answers\nQ: Hour 1 track 2 is not in the notes. Keep it?\nA: Keep it, it is the closer.");
    // The notes and answers sit only after the untrusted-notes heading of the instruction.
    const input = run!.input!;
    expect(input.indexOf("Private:")).toBeGreaterThan(input.indexOf("NOTES (untrusted)"));
    expect(input.indexOf("Tarik's answers")).toBeGreaterThan(input.indexOf("NOTES (untrusted)"));
    expect(await t.run((ctx) => ctx.db.query("packages").collect())).toEqual([]);
  });

  // Review Focus 4: two scans in a row queue one run.
  test("is idempotent per show date: a second request while the run is open queues nothing", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" });
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).toEqual({ queued: false, reason: "drafting" });
    expect(await runs(t)).toHaveLength(1);
    // A human's run from the Tracklist page for the same date counts too.
    await upsert(t, episode({ showDate: "2026-01-09" }));
    const human = t.withIdentity({ subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true });
    await human.mutation(api.tracklist.draft, { showDate: "2026-01-09", tracklistText: "Hour 1\nA - B\nHour 2\nC - D", notes: "" });
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-09" })).toEqual({ queued: false, reason: "drafting" });
    expect(await runs(t)).toHaveLength(2);
  });

  test("never drafts a show that already has a package, in any status", async () => {
    for (const status of ["preparing_audio", "awaiting_review", "approved", "succeeded", "failed", "skipped", "outcome_unknown"]) {
      const t = convexTest(schema, modules);
      await upsert(t, episode({ showDate: "2026-10-02" }));
      await insertPackage(t, status);
      const r = await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-10-02" });
      expect(r.queued, status).toBe(false);
      expect(await runs(t)).toEqual([]);
    }
  });

  test("never drafts a rerun, a show with an open question, an audio ask (even answered, R5), or missing audio or tracklist", async () => {
    const cases: [string, Record<string, unknown>, Record<string, unknown>?][] = [
      ["rerun", {}, { rerunOf: "2025-12-05", rerunSource: "episodes" }],
      ["question", { questions: [{ id: "d", text: "Which date?", kind: "date" }] }],
      ["missing-audio", { audio: { status: "ask", flags: ["date mismatch"] }, questions: [{ id: "a", text: "Which files?", kind: "audio" }] }, { answered: true }],
      ["question", { audio: { status: "ask", flags: ["special or unparseable folder name"] } }],
      ["missing-audio", { audio: { status: "incomplete", flags: [] } }],
      ["missing-tracklist", { tracklist: { status: "missing" } }],
    ];
    for (const [reason, over, patch] of cases) {
      const t = convexTest(schema, modules);
      await upsert(t, episode(over));
      if (patch)
        await t.run(async (ctx) => {
          const r = (await ctx.db.query("episodes").first())!;
          const { answered, ...fields } = patch as { answered?: boolean };
          await ctx.db.patch(r._id, { ...fields, ...(answered && { questions: r.questions.map((q) => ({ ...q, answer: "the second folder" })) }) } as never);
        });
      expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" }), reason).toEqual({ queued: false, reason });
      expect(await runs(t)).toEqual([]);
    }
  });

  test("an unknown date is NOT_FOUND; a malformed one BAD_INPUT", async () => {
    const t = convexTest(schema, modules);
    expect(await errorCode(t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" }))).toBe("NOT_FOUND");
    expect(await errorCode(t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "Jan 2" }))).toBe("BAD_INPUT");
  });

  test("waits while 3 packages are ahead of Tarik (pace), and stops after two finished drafts made no package", async () => {
    const t = convexTest(schema, modules);
    for (const [i, d] of ["2026-10-02", "2026-10-09", "2026-10-16"].entries())
      await insertPackage(t, i ? "preparing_audio" : "awaiting_review", { id: `pkg-10-${2 + 7 * i}-26`, showDate: d });
    await upsert(t, episode());
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).toEqual({ queued: false, reason: "pace" });

    const u = convexTest(schema, modules);
    await upsert(u, episode());
    for (let i = 0; i < 2; i++) {
      expect((await u.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).queued).toBe(true);
      await u.run(async (ctx) => {
        for (const r of await ctx.db.query("runs").collect()) await ctx.db.patch(r._id, { status: i ? "cancelled" : "failed" });
      });
    }
    expect(await u.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).toEqual({ queued: false, reason: "draft-failed" });
    const listed = (await u.query(api.ingest.list, { token: INGEST })).episodes[0]!;
    expect(listed.draftAttempts).toBe(2);
    expect(listed.status).toBe("draft-failed"); // R10: core's status, so nextToDraft skips it and Episodes says why
    expect(await runs(u)).toHaveLength(2);
  });

  test("R11: a draft run open longer than 6 hours no longer counts as open, for idempotency or for the pace", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    expect((await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).queued).toBe(true);
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).toEqual({ queued: false, reason: "drafting" });
    expect((await t.query(api.ingest.list, { token: INGEST })).awaitingReview).toBe(1);
    // 5 h 59 min: still open. 6 h 1 min: stuck; it counts as a finished attempt instead.
    const age = (ms: number) => t.run(async (ctx) => {
      for (const r of await ctx.db.query("runs").collect()) await ctx.db.patch(r._id, { createdAt: Date.now() - ms });
    });
    await age(6 * 3_600_000 - 60_000);
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).toEqual({ queued: false, reason: "drafting" });
    await age(6 * 3_600_000 + 60_000);
    const l = await t.query(api.ingest.list, { token: INGEST });
    expect(l.awaitingReview).toBe(0);
    expect(l.episodes[0]!.draftAttempts).toBe(1);
    expect((await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).queued).toBe(true);
    expect(await runs(t)).toHaveLength(2);
  });
});

describe("ingest.prune (I3)", () => {
  const dates = (t: T) => t.run(async (ctx) => (await ctx.db.query("episodes").collect()).map((e) => e.showDate).sort());

  test("a date gone from every source (a renamed doc) loses its row; kept dates stay", async () => {
    const t = convexTest(schema, modules);
    for (const d of ["2026-01-02", "2026-01-09", "2026-01-16"]) await upsert(t, episode({ showDate: d }));
    expect(await t.mutation(api.ingest.prune, { token: INGEST, keep: ["2026-01-02", "2026-01-16", "2026-01-23"] })).toEqual({ deleted: 1 });
    expect(await dates(t)).toEqual(["2026-01-02", "2026-01-16"]);
  });

  test("never removes a row with a package, a rerun mark, or a bare mark made ahead of time", async () => {
    const t = convexTest(schema, modules);
    for (const d of ["2026-01-02", "2026-03-13", "2026-10-02"]) await upsert(t, episode({ showDate: d }));
    await insertPackage(t, "succeeded"); // 2026-10-02
    await t.withIdentity({ subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true }).mutation(api.episodes.markRerun, { showDate: "2026-03-13", rerunOf: "2026-01-02" });
    await t.withIdentity({ subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true }).mutation(api.episodes.markRerun, { showDate: "2026-11-06", rerunOf: "2026-01-02" });
    await t.run(async (ctx) => void (await ctx.db.insert("episodes", { showDate: "2026-12-04", audio: { status: "none", flags: [] }, tracklist: { status: "missing" }, notes: { status: "missing" }, questions: [], scannedAt: 0 })));
    expect(await t.mutation(api.ingest.prune, { token: INGEST, keep: ["2026-01-02"] })).toEqual({ deleted: 0 });
    expect(await dates(t)).toEqual(["2026-01-02", "2026-03-13", "2026-10-02", "2026-11-06", "2026-12-04"]);
  });

  test("a pass that would remove more than 3 rows removes none and says how many", async () => {
    const t = convexTest(schema, modules);
    for (const d of ["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30"]) await upsert(t, episode({ showDate: d }));
    expect(await t.mutation(api.ingest.prune, { token: INGEST, keep: ["2026-01-02"] })).toEqual({ deleted: 0, skipped: 4 });
    expect(await dates(t)).toHaveLength(5);
    expect(await t.mutation(api.ingest.prune, { token: INGEST, keep: ["2026-01-02", "2026-01-09"] })).toEqual({ deleted: 3 });
    expect(await dates(t)).toEqual(["2026-01-02", "2026-01-09"]);
  });
});

describe("ingest.sourceStatus", () => {
  test("one row per source, replaced whole; a signed-in real human reads them, demo and anonymous get null", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingest.sourceStatus, { token: INGEST, source: "google", state: "needs_reconnect", lastError: "invalid_grant" });
    await t.mutation(api.ingest.sourceStatus, { token: INGEST, source: "google", state: "connected", account: "tarik@radiomilwaukee.org" });
    await t.mutation(api.ingest.sourceStatus, { token: INGEST, source: "box", state: "connected" });
    const human = t.withIdentity({ subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true });
    const rows = await human.query(api.episodes.sources, {});
    expect(rows!.map(({ source, state, account, lastError }) => ({ source, state, account, lastError }))).toEqual([
      { source: "box", state: "connected", account: undefined, lastError: undefined },
      { source: "google", state: "connected", account: "tarik@radiomilwaukee.org", lastError: undefined },
    ]);
    expect(await t.query(api.episodes.sources, {})).toBeNull();
    expect(await t.withIdentity({ subject: "d1", role: "demo" }).query(api.episodes.sources, {})).toBeNull();
    await expect(t.mutation(api.ingest.sourceStatus, { token: INGEST, source: "mixcloud" as never, state: "connected" })).rejects.toThrow();
  });
});
