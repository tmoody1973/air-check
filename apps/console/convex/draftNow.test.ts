// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api } from "./_generated/api";
import schema from "./schema";

// Oct 30 (Tarik): Draft now on an Episodes row. Same checks and inputs as the ingest service's request, minus the
// oldest-first order and the pace of 3. A signed-in real human only.
const modules = import.meta.glob("./**/*.*s");
const INGEST = "i".repeat(48);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo" };
type T = ReturnType<typeof convexTest>;

beforeEach(() => vi.stubEnv("INGEST_TOKEN", INGEST));
afterEach(() => vi.unstubAllEnvs());

const track = (hour: 1 | 2, position: number, artist: string, title: string, closing = false) => ({
  hour, position, artist, title, raw: `${artist} - ${title}`, closing, status: closing ? ("closing-track" as const) : ("confirmed" as const),
});
const TRACKS = [track(1, 1, "Alfa Mist", "Organic Rust"), track(1, 2, "Nala Sinephro", "Space 1", true), track(2, 1, "Kokoroko", "Abusey Junction"), track(2, 2, "Yussef Dayes", "Black Classical Music", true)];
const episode = (over: Record<string, unknown> = {}) => ({
  showDate: "2026-01-02",
  audio: { status: "ready" as const, folderId: "f1", hour1: { id: "b1", name: "RLR_H1_010226.wav", size: 600_000_000 }, hour2: { id: "b2", name: "RLR_H2_010226.wav", size: 600_000_000 }, pattern: "rlr", flags: [] },
  tracklist: { status: "found" as const, docId: "g1", tracks: TRACKS },
  notes: { status: "found" as const, docId: "p1", text: "Notes." },
  questions: [],
  ...over,
});
const upsert = (t: T, ep: unknown) => t.mutation(api.ingest.upsert, { token: INGEST, episode: ep as never });
const draftRuns = (t: T) => t.run(async (ctx) => (await ctx.db.query("runs").collect()).filter((r) => r.kind === "draft-package"));
const insertPackage = (t: T, status: string, over: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const draft = goldenDraft(over as never);
    await ctx.db.insert("packages", { packageId: draft.id, workspace: draft.workspace, status, draft });
  });
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string; message?: string } }).data ?? String(e);
  }
  return "no error";
};

describe("draftNow.draftNow", () => {
  test("drafts the chosen show now, even with 3 packages waiting (the ingest service is held by the pace)", async () => {
    const t = convexTest(schema, modules);
    for (const [i, d] of ["2026-10-02", "2026-10-09", "2026-10-16"].entries()) await insertPackage(t, "awaiting_review", { id: `pkg-${i}`, showDate: d });
    await upsert(t, episode());
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-01-02" })).toEqual({ queued: false, reason: "pace" });
    const { runId } = await t.withIdentity(human).mutation(api.draftNow.draftNow, { showDate: "2026-01-02" });
    const runs = await draftRuns(t);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId, workspace: "real", kind: "draft-package" });
    expect(runs[0]!.form).toMatchObject({ showDate: "2026-01-02" });
    expect(runs[0]!.form!.tracklistText).toContain("Alfa Mist");
  });

  test("a second click while it drafts is refused in plain words; no second run", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    await t.withIdentity(human).mutation(api.draftNow.draftNow, { showDate: "2026-01-02" });
    expect(await errorOf(t.withIdentity(human).mutation(api.draftNow.draftNow, { showDate: "2026-01-02" }))).toMatchObject({ code: "BAD_INPUT", message: expect.stringMatching(/already drafting/) });
    expect(await draftRuns(t)).toHaveLength(1);
  });

  test("a show that isn't ready (missing audio) is refused; nothing queued", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode({ audio: { status: "none", flags: [] } }));
    expect(await errorOf(t.withIdentity(human).mutation(api.draftNow.draftNow, { showDate: "2026-01-02" }))).toMatchObject({ code: "BAD_INPUT" });
    expect(await draftRuns(t)).toHaveLength(0);
  });

  test("the demo and a signed-out visitor are refused", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    expect(await errorOf(t.withIdentity(demo).mutation(api.draftNow.draftNow, { showDate: "2026-01-02" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errorOf(t.mutation(api.draftNow.draftNow, { showDate: "2026-01-02" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await draftRuns(t)).toHaveLength(0);
  });
});
