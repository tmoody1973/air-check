// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api } from "./_generated/api";
import schema from "./schema";

// Plan 6b Task 2 (decision 017): Tarik's fixes, saved in Air Check per show. Only a signed-in real human writes them
// (Hard Rule 9), only ids a question offered are accepted (Review Focus 5), and a drafted show is frozen.
const modules = import.meta.glob("./**/*.*s");
const INGEST = "i".repeat(48);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
const outsider = { subject: "x1", email: "someone@gmail.com", emailVerified: true };
type T = ReturnType<typeof convexTest>;

beforeEach(() => vi.stubEnv("INGEST_TOKEN", INGEST));
afterEach(() => vi.unstubAllEnvs());

const D = "2026-04-17";
const TRACKS = [
  { hour: 1 as const, position: 1, artist: "Donalyd Byrd", title: "Change", raw: "Donalyd Byrd - Change", closing: true, status: "closing-track" as const },
  { hour: 2 as const, position: 1, artist: "C", title: "D", raw: "C - D", closing: true, status: "closing-track" as const },
];
const Q = {
  drive: { id: "dup", text: "Drive has 2 tracklists.", kind: "tracklist" as const, action: true as const, fix: { type: "pick" as const, source: "drive" as const, choices: [{ id: "g1", name: "RLR 4-17-26" }, { id: "g2", name: "RLR 4-17-26 (copy)" }] } },
  box: { id: "box", text: "Box has 2 folders.", kind: "audio" as const, action: true as const, fix: { type: "pick" as const, source: "box" as const, choices: [{ id: "f1", name: "4-17-26" }, { id: "f2", name: "4-17-26 b" }] } },
  hours: { id: "hrs", text: "Which file is which hour?", kind: "audio" as const, fix: { type: "hours" as const, choices: [{ id: "w1", name: "a.wav" }, { id: "w2", name: "b.wav" }, { id: "w3", name: "c.wav" }] } },
  stamp: { id: "stamp", text: "The folder says 4-17 but the files say 4-10.", kind: "date" as const, fix: { type: "stamp" as const, folderDate: D, stampDate: "2026-04-10" } },
  typed: { id: "tl", text: "Line 3 could not be read.", kind: "tracklist" as const, action: true as const, fix: { type: "tracklist" as const } },
};
const episode = (over: Record<string, unknown> = {}) => ({
  showDate: D,
  audio: { status: "ask" as const, flags: [] },
  tracklist: { status: "found" as const, docId: "g1", tracks: TRACKS, text: "HOUR 1\nDonalyd Byrd - Change\n\nHOUR 2\nC - D" },
  notes: { status: "missing" as const },
  questions: [Q.drive, Q.box, Q.hours, Q.stamp, Q.typed],
  ...over,
});
const upsert = (t: T, ep: unknown) => t.mutation(api.ingest.upsert, { token: INGEST, episode: ep as never });
const correction = (t: T) => t.run((ctx) => ctx.db.query("corrections").withIndex("by_showDate", (q) => q.eq("showDate", D)).unique());
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: { code?: string; message?: string } }).data;
    return { code: data?.code ?? String(e), message: data?.message ?? "" };
  }
  return { code: "no error", message: "" };
};
const code = async (p: Promise<unknown>) => (await failure(p)).code;
const GOOD = "HOUR 1\nDonald Byrd - Change\nNala Sinephro - Space 1\n\nHOUR 2\nKokoroko - Abusey Junction";

/** Every correction mutation, called as `who` for show D with valid arguments. */
const calls = (as: T) => [
  as.mutation(api.corrections.setTracklist, { showDate: D, text: GOOD }),
  as.mutation(api.corrections.pick, { showDate: D, source: "drive", id: "g2" }),
  as.mutation(api.corrections.setHours, { showDate: D, hour1: "w1", hour2: "w2" }),
  as.mutation(api.corrections.useFolderDate, { showDate: D }),
  as.mutation(api.corrections.clear, { showDate: D }),
];

describe("access (Hard Rule 9)", () => {
  test("demo, signed-out and outside users get FORBIDDEN on every mutation and null from the queries", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await t.mutation(api.ingest.reportUnplaced, { token: INGEST, items: [{ source: "paper", id: "p9", name: "Rhythm Lab Radio 9-4-226", reason: "bad year" }] });
    for (const as of [t, t.withIdentity(demo), t.withIdentity(outsider)]) {
      for (const c of calls(as)) expect(await code(c)).toBe("FORBIDDEN");
      expect(await code(as.mutation(api.corrections.place, { source: "paper", id: "p9", date: "2026-09-04" }))).toBe("FORBIDDEN");
      expect(await code(as.mutation(api.corrections.unplace, { source: "paper", id: "p9" }))).toBe("FORBIDDEN");
      expect(await as.query(api.corrections.tracklistText, { showDate: D })).toBeNull();
      expect(await as.query(api.episodes.unplaced, {})).toBeNull();
    }
    expect(await t.run((ctx) => ctx.db.query("corrections").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("placements").collect())).toEqual([]);
  });

  test("an unknown show is NOT_FOUND", async () => {
    const t = convexTest(schema, modules);
    for (const c of calls(t.withIdentity(human))) expect(await code(c)).toBe("NOT_FOUND");
  });
});

describe("typed tracklists (Review Focus 4)", () => {
  test("a 2-hour text is saved exactly as typed", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await t.withIdentity(human).mutation(api.corrections.setTracklist, { showDate: D, text: GOOD });
    expect(await correction(t)).toMatchObject({ showDate: D, tracklistText: GOOD, updatedAt: expect.any(Number) });
  });

  test("refuses one hour only, an unreadable line, 101 tracks and over 20,000 characters, saying why", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    const set = (text: string) => failure(t.withIdentity(human).mutation(api.corrections.setTracklist, { showDate: D, text }));
    const many = (n: number) => Array.from({ length: n }, (_, i) => `Artist ${i} - Title ${i}`);
    expect(await set("HOUR 1\nA - B\nC - D")).toEqual({ code: "BAD_INPUT", message: expect.stringContaining("no Hour 2 tracks") });
    expect(await set("HOUR 1\nA - B\nno dash\n\nHOUR 2\nC - D")).toEqual({ code: "BAD_INPUT", message: expect.stringContaining("Line 3") });
    expect(await set(["HOUR 1", ...many(51), "HOUR 2", ...many(50)].join("\n"))).toEqual({ code: "BAD_INPUT", message: expect.stringContaining("101 tracks") });
    expect(await set(`HOUR 1\nA - B\nHOUR 2\nC - ${"x".repeat(20_000)}`)).toEqual({ code: "BAD_INPUT", message: expect.stringContaining("20,000") });
    expect(await correction(t)).toBeNull();
  });
});

describe("forged choices (Review Focus 5)", () => {
  test("pick accepts only an id the show's question offered for that source", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode({ questions: [Q.drive, Q.box] }));
    const h = t.withIdentity(human);
    expect(await code(h.mutation(api.corrections.pick, { showDate: D, source: "drive", id: "g9" }))).toBe("BAD_INPUT");
    expect(await code(h.mutation(api.corrections.pick, { showDate: D, source: "drive", id: "f1" }))).toBe("BAD_INPUT"); // Box's id, not Drive's
    expect(await code(h.mutation(api.corrections.pick, { showDate: D, source: "paper", id: "g1" }))).toBe("BAD_INPUT"); // no Paper question
    await h.mutation(api.corrections.pick, { showDate: D, source: "drive", id: "g2" });
    await h.mutation(api.corrections.pick, { showDate: D, source: "box", id: "f2" });
    expect(await correction(t)).toMatchObject({ drive: "g2", box: "f2" });
  });

  test("setHours accepts only two different ids from the hours choices", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    const h = t.withIdentity(human);
    expect(await code(h.mutation(api.corrections.setHours, { showDate: D, hour1: "w1", hour2: "w1" }))).toBe("BAD_INPUT");
    expect(await code(h.mutation(api.corrections.setHours, { showDate: D, hour1: "w1", hour2: "f1" }))).toBe("BAD_INPUT");
    await h.mutation(api.corrections.setHours, { showDate: D, hour1: "w3", hour2: "w1" });
    expect((await correction(t))!.hours).toEqual({ hour1: "w3", hour2: "w1" });

    const u = convexTest(schema, modules);
    await upsert(u, episode({ questions: [Q.drive] }));
    expect(await code(u.withIdentity(human).mutation(api.corrections.setHours, { showDate: D, hour1: "w1", hour2: "w2" }))).toBe("BAD_INPUT");
  });

  test("useFolderDate works only when a stamp question exists", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode({ questions: [Q.drive] }));
    expect(await code(t.withIdentity(human).mutation(api.corrections.useFolderDate, { showDate: D }))).toBe("BAD_INPUT");
    await upsert(t, episode());
    await t.withIdentity(human).mutation(api.corrections.useFolderDate, { showDate: D });
    expect((await correction(t))!.folderDate).toBe(true);
  });
});

describe("each mutation touches only its own field", () => {
  test("a later fix keeps the earlier ones, and clear (Use Drive again) deletes the row", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    const h = t.withIdentity(human);
    await h.mutation(api.corrections.setTracklist, { showDate: D, text: GOOD });
    await h.mutation(api.corrections.pick, { showDate: D, source: "drive", id: "g2" });
    await h.mutation(api.corrections.setHours, { showDate: D, hour1: "w1", hour2: "w2" });
    await h.mutation(api.corrections.useFolderDate, { showDate: D });
    const { _id, _creationTime, ...c } = (await correction(t))!;
    void _id, _creationTime;
    expect(c).toEqual({ showDate: D, tracklistText: GOOD, drive: "g2", hours: { hour1: "w1", hour2: "w2" }, folderDate: true, updatedAt: expect.any(Number) });
    await h.mutation(api.corrections.clear, { showDate: D });
    expect(await correction(t)).toBeNull();
    await h.mutation(api.corrections.clear, { showDate: D }); // nothing to clear: fine
  });
});

describe("frozen shows", () => {
  const frozen = "this show already has a package; change it on the package page";

  test("every mutation refuses a show with a package, in any status", async () => {
    for (const status of ["awaiting_review", "skipped", "succeeded"]) {
      const t = convexTest(schema, modules);
      await upsert(t, episode());
      await t.run(async (ctx) => {
        const draft = goldenDraft({ id: "pkg-4-17-26", showDate: D } as never);
        await ctx.db.insert("packages", { packageId: draft.id, workspace: "real", status, draft });
      });
      for (const c of calls(t.withIdentity(human))) expect(await failure(c)).toEqual({ code: "BAD_INPUT", message: frozen });
    }
  });

  test("every mutation refuses a show with an open draft run", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await t.run((ctx) =>
      ctx.db.insert("runs", {
        workspace: "real", runId: "r1", title: "Draft", state: {}, updatedAt: Date.now(), kind: "draft-package", status: "running",
        form: { showDate: D, tracklistText: "x", notes: "" }, createdAt: Date.now(),
      }),
    );
    for (const c of calls(t.withIdentity(human))) expect(await failure(c)).toEqual({ code: "BAD_INPUT", message: frozen });
  });
});

describe("R3: audio already downloaded", () => {
  test("audio corrections, and clearing one, are refused once the show's audio is on disk; tracklist fixes are not", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    const h = t.withIdentity(human);
    await h.mutation(api.corrections.pick, { showDate: D, source: "box", id: "f1" });
    await upsert(t, episode({ audioOnDisk: true }));
    const onDisk = { code: "BAD_INPUT", message: "this show's audio is already downloaded" };
    expect(await failure(h.mutation(api.corrections.pick, { showDate: D, source: "box", id: "f2" }))).toEqual(onDisk);
    expect(await failure(h.mutation(api.corrections.setHours, { showDate: D, hour1: "w1", hour2: "w2" }))).toEqual(onDisk);
    expect(await failure(h.mutation(api.corrections.useFolderDate, { showDate: D }))).toEqual(onDisk);
    expect(await failure(h.mutation(api.corrections.clear, { showDate: D }))).toEqual(onDisk);
    await h.mutation(api.corrections.pick, { showDate: D, source: "drive", id: "g2" });
    await h.mutation(api.corrections.setTracklist, { showDate: D, text: GOOD });
    expect(await correction(t)).toMatchObject({ box: "f1", drive: "g2", tracklistText: GOOD });

    const u = convexTest(schema, modules);
    await upsert(u, episode({ audioOnDisk: true }));
    await u.withIdentity(human).mutation(api.corrections.setTracklist, { showDate: D, text: GOOD });
    await u.withIdentity(human).mutation(api.corrections.clear, { showDate: D }); // no audio field: fine
    expect(await correction(u)).toBeNull();
  });
});

describe("corrections.tracklistText (the editor's text)", () => {
  test("falls back from the correction to the Drive text, to the stored tracks, to empty", async () => {
    const t = convexTest(schema, modules);
    const h = t.withIdentity(human);
    expect(await h.query(api.corrections.tracklistText, { showDate: D })).toEqual({ text: "", from: "none" });
    await upsert(t, episode({ tracklist: { status: "missing" } }));
    expect(await h.query(api.corrections.tracklistText, { showDate: D })).toEqual({ text: "", from: "none" });
    await upsert(t, episode({ tracklist: { status: "found", tracks: TRACKS } }));
    expect(await h.query(api.corrections.tracklistText, { showDate: D })).toEqual({ text: 'Hour 1\nDonalyd Byrd - "Change"\n\nHour 2\nC - "D"', from: "tracks" });
    await upsert(t, episode());
    expect(await h.query(api.corrections.tracklistText, { showDate: D })).toEqual({ text: "HOUR 1\nDonalyd Byrd - Change\n\nHOUR 2\nC - D", from: "drive" });
    await h.mutation(api.corrections.setTracklist, { showDate: D, text: GOOD });
    expect(await h.query(api.corrections.tracklistText, { showDate: D })).toEqual({ text: GOOD, from: "air-check" });
  });
});

describe("undated names", () => {
  const item = { source: "paper" as const, id: "p9", name: "Rhythm Lab Radio 9-4-226", reason: "The year 226 is not 2026." };

  test("place accepts only a current unplaced item and a real 2026 show date; unplace removes it", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingest.reportUnplaced, { token: INGEST, items: [item] });
    const h = t.withIdentity(human);
    expect(await code(h.mutation(api.corrections.place, { source: "paper", id: "p8", date: "2026-09-04" }))).toBe("BAD_INPUT");
    expect(await code(h.mutation(api.corrections.place, { source: "drive", id: "p9", date: "2026-09-04" }))).toBe("BAD_INPUT");
    expect(await code(h.mutation(api.corrections.place, { source: "paper", id: "p9", date: "2025-09-04" }))).toBe("BAD_INPUT");
    expect(await code(h.mutation(api.corrections.place, { source: "paper", id: "p9", date: "2026-02-30" }))).toBe("BAD_INPUT");
    await h.mutation(api.corrections.place, { source: "paper", id: "p9", date: "2026-09-04" });
    await h.mutation(api.corrections.place, { source: "paper", id: "p9", date: "2026-09-11" });
    const placed = await t.run((ctx) => ctx.db.query("placements").collect());
    expect(placed).toEqual([expect.objectContaining({ source: "paper", id: "p9", date: "2026-09-11", updatedAt: expect.any(Number) })]);
    expect(await h.query(api.episodes.unplaced, {})).toEqual([{ ...item, seenAt: expect.any(Number) }]);
    await h.mutation(api.corrections.unplace, { source: "paper", id: "p9" });
    expect(await t.run((ctx) => ctx.db.query("placements").collect())).toEqual([]);
  });

  test("placing on a drafted show is refused", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingest.reportUnplaced, { token: INGEST, items: [item] });
    await t.run(async (ctx) => {
      const draft = goldenDraft({ id: "pkg-9-4-26", showDate: "2026-09-04" } as never);
      await ctx.db.insert("packages", { packageId: draft.id, workspace: "real", status: "awaiting_review", draft });
    });
    expect(await code(t.withIdentity(human).mutation(api.corrections.place, { source: "paper", id: "p9", date: "2026-09-04" }))).toBe("BAD_INPUT");
  });
});
