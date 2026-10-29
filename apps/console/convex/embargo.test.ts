// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { foldText, releaseKey } from "@aircheck/core";
import { goldenDescription, leadsOf } from "../../../packages/core/test/helpers/fixtures";
import { draftRunFor, goldenDraft, goldenTracks } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Plan 8 Task 5, Review Focus 3: an active embargo blocks public text, Approve and the publisher until its date or
// Tarik's "Clear embargo". Records embargoed until 2026-11-07 and one with no date; the clock reads 2026-10-30.
const modules = import.meta.glob("./**/*.*s");
const PUB = "p".repeat(48);
const MEDIA = "m".repeat(48);
const AGENT = "a".repeat(48);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demoUser = { subject: "d1", role: "demo" };
const URL_ = "https://www.mixcloud.com/rhythmlab/x/";
type T = ReturnType<typeof convexTest>;

const OCT_30 = new Date("2026-10-30T17:00:00Z");
const NOV_7 = new Date("2026-11-07T17:00:00Z");
const DATED = "'Moonlit Avenue' by Nova Reyes is embargoed until 2026-11-07";
// R8 (Hard Rule 10): what the agent is told quotes its own words, never the release's artist or title.
const AGENT_DATED = 'The title "Moonlit Avenue" in your description is embargoed until 2026-11-07. Leave it out.';
const AGENT_UNDATED = 'The title "Hidden Room" in your description is embargoed (no date known). Leave it out.';
const UNDATED = "'Hidden Room' by Nova Reyes is embargoed (date not known)";

// A track of the golden package whose title the golden description never names, so only its tracklist entry matches.
const prose = ` ${foldText(goldenDescription())} `;
const quiet = goldenTracks().filter((x) => !x.closing && !prose.includes(` ${foldText(x.title)} `) && !prose.includes(` ${foldText(x.artist)} `));
const [trackA, trackB, trackC] = quiet;
const at = (x: { artist: string; title: string }) => ({ artist: x.artist, title: x.title });
const trackLine = (x: { artist: string; title: string }, until: string | null) =>
  `'${x.title}' by ${x.artist} is embargoed ${until ? `until ${until}` : "(date not known)"}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(OCT_30);
  vi.stubEnv("PUBLISHER_TOKEN", PUB);
  vi.stubEnv("MEDIA_TOKEN", MEDIA);
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("AIRCHECK_PRIVATE_TERMS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const release = (t: T, fields: Record<string, unknown>) =>
  t.run((ctx) =>
    ctx.db.insert("releases", {
      workspace: "real", status: "new", key: releaseKey(String(fields.artist), String(fields.title)), ...fields,
    } as never),
  ) as Promise<Id<"releases">>;
/** The two description embargoes of Review Focus 3, in a workspace. */
const proseEmbargoes = async (t: T, workspace: "real" | "demo" = "real") => {
  await release(t, { workspace, artist: "Nova Reyes", title: "Moonlit Avenue", embargo: { until: "2026-11-07" } });
  await release(t, { workspace, artist: "Nova Reyes", title: "Hidden Room", embargo: { until: null } });
};
const pkg = (t: T, id: string) => t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());
const errorData = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string; message?: string; problems?: string[] } }).data ?? { code: String(e) };
  }
  return { code: "no error" };
};

async function reviewable(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" }, ...overrides });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  if (draft.workspace === "demo")
    await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "pending", hour2Id: "pending", mp3Sha256: "c".repeat(64) } });
  else
    await t.mutation(api.media.attached, { token: MEDIA, packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 3600, mp3Bytes: 10 });
  return draft.id;
}
const decide = async (t: T, id: string, decision: "approve" | "skip", who: object = human) =>
  t.withIdentity(who).mutation(api.packages.decide, { packageId: id, fingerprint: (await pkg(t, id))!.fingerprint!, decision });

describe("description checks", () => {
  const named = `${goldenDescription()} Moonlit Avenue. Hidden Room.`;

  test("agent submit is refused in the agent's own words, never naming the release's artist", async () => {
    const t = convexTest(schema, modules);
    await proseEmbargoes(t);
    const draft = goldenDraft();
    await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
    const input = { showDate: draft.showDate, leads: leadsOf(draft.title), tags: draft.tags, description: named, hour1Id: "h1", hour2Id: "h2" };
    const err = await errorData(t.mutation(internal.packages.submit, { agent: { input, workspace: "real" } }));
    expect(err.code).toBe("BAD_INPUT");
    expect(err.problems).toEqual(expect.arrayContaining([AGENT_DATED, AGENT_UNDATED]));
    expect(JSON.stringify(err)).not.toContain("Nova Reyes");
    expect(await pkg(t, draft.id)).toBeNull();
  });

  test("a prebuilt submit, agent revise and Tarik's edit are refused the same way", async () => {
    const t = convexTest(schema, modules);
    await proseEmbargoes(t);
    const pre = await errorData(t.mutation(internal.packages.submit, { draft: goldenDraft({ description: named }) }));
    expect(pre).toMatchObject({ code: "BAD_INPUT" });
    expect(JSON.stringify(pre)).not.toContain("Nova Reyes");
    const id = await reviewable(t);
    const r = await t.mutation(internal.packages.revise, { workspace: "real", packageId: id, description: named });
    expect(r).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect(r.ok === false && "problems" in r && r.problems).toEqual(expect.arrayContaining([AGENT_DATED, AGENT_UNDATED]));
    expect(JSON.stringify(r)).not.toContain("Nova Reyes");
    // Tarik's own edit is a private view: he reads the release in full.
    const e = await t.withIdentity(human).mutation(api.packages.editDescription, { packageId: id, description: named });
    expect(e).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect(!e.ok && e.message).toContain(`${DATED}. Leave it out.`);
    expect((await pkg(t, id))!.draft.description).toBe(goldenDescription());
  });

  test("a proposed live update is refused", async () => {
    const t = convexTest(schema, modules);
    const id = await reviewable(t);
    await decide(t, id, "approve");
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
    await proseEmbargoes(t);
    const r = await t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId: id, description: named });
    expect(r).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect(!r.ok && r.message).toContain(`${UNDATED}. Leave it out.`);
    expect(await t.run((ctx) => ctx.db.query("descriptionUpdates").collect())).toEqual([]);
  });

  test("an update approved before the embargo arrived is not handed to the publisher until the date", async () => {
    const t = convexTest(schema, modules);
    const id = await reviewable(t);
    await decide(t, id, "approve");
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
    const text = `${goldenDescription()} Moonlit Avenue.`;
    const p = await t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId: id, description: text });
    const u = await t.run((ctx) => ctx.db.get(p.ok ? p.id : (null as never)));
    await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id: u!._id, fingerprint: u!.fingerprint });
    await release(t, { artist: "Nova Reyes", title: "Moonlit Avenue", embargo: { until: "2026-11-07" } });
    expect(await t.mutation(api.descriptionUpdates.claim, { token: PUB })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(u!._id)))!.status).toBe("approved");
    vi.setSystemTime(NOV_7);
    expect(await t.mutation(api.descriptionUpdates.claim, { token: PUB })).toMatchObject({ id: u!._id, description: text });
  });

  test("on 2026-11-07 the dated title passes; the undated one still blocks", async () => {
    const t = convexTest(schema, modules);
    await proseEmbargoes(t);
    const id = await reviewable(t);
    vi.setSystemTime(NOV_7);
    const ok = await t.withIdentity(human).mutation(api.packages.editDescription, { packageId: id, description: `${goldenDescription()} Moonlit Avenue.` });
    expect(!ok.ok && ok.message).not.toContain("Moonlit");
    const no = await t.withIdentity(human).mutation(api.packages.editDescription, { packageId: id, description: `${goldenDescription()} Hidden Room.` });
    expect(!no.ok && no.message).toContain(`${UNDATED}. Leave it out.`);
  });
});

describe("Approve", () => {
  test("a package whose track is embargoed cannot be approved; Skip works", async () => {
    const t = convexTest(schema, modules);
    await release(t, { ...at(trackA!), embargo: { until: "2026-11-07" } });
    const id = await reviewable(t);
    const r = await decide(t, id, "approve");
    expect(r).toEqual({ ok: false, code: "EMBARGOED", message: `${trackLine(trackA!, "2026-11-07")}. Approve after that date, or clear the embargo.` });
    expect((await pkg(t, id))!.status).toBe("awaiting_review");
    expect(await decide(t, id, "skip")).toMatchObject({ ok: true, record: { status: "skipped" } });
  });

  test("on 2026-11-07 the dated one approves; an undated one blocks until a human clears it", async () => {
    const t = convexTest(schema, modules);
    await release(t, { ...at(trackA!), embargo: { until: "2026-11-07" } });
    const undated = await release(t, { ...at(trackB!), embargo: { until: null } });
    const id = await reviewable(t);
    vi.setSystemTime(NOV_7);
    const r = await decide(t, id, "approve");
    expect(r).toMatchObject({ ok: false, code: "EMBARGOED" });
    expect(!r.ok && r.message).not.toContain(trackA!.title);
    expect(!r.ok && r.message).toContain(trackLine(trackB!, null));

    // Only a signed-in human clears a real embargo.
    expect(await errorData(t.mutation(api.radar.setEmbargo, { releaseId: undated, embargo: null }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errorData(t.withIdentity(demoUser).mutation(api.radar.setEmbargo, { releaseId: undated, embargo: null }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await decide(t, id, "approve")).toMatchObject({ ok: false, code: "EMBARGOED" });
    await t.withIdentity(human).mutation(api.radar.setEmbargo, { releaseId: undated, embargo: null });
    expect(await decide(t, id, "approve")).toMatchObject({ ok: true, record: { status: "approved" } });
  });

  test("Hard Rule 9: a demo package never meets a real embargo", async () => {
    const t = convexTest(schema, modules);
    await release(t, { ...at(trackA!), embargo: { until: null } });
    const demoId = await reviewable(t, { workspace: "demo", id: "demo-10-2-26" });
    expect(await decide(t, demoId, "approve", demoUser)).toMatchObject({ ok: true });
  });

  test("Hard Rule 9: a real package never meets a demo embargo, while a demo package does", async () => {
    const t = convexTest(schema, modules);
    await release(t, { ...at(trackA!), workspace: "demo", embargo: { until: null } });
    const realId = await reviewable(t);
    expect(await decide(t, realId, "approve")).toMatchObject({ ok: true });
    const demoId = await reviewable(t, { workspace: "demo", id: "demo-10-2-26" });
    expect(await decide(t, demoId, "approve", demoUser)).toMatchObject({ ok: false, code: "EMBARGOED" });
  });
});

describe("the publisher", () => {
  test("an embargo set after approval holds the package: left out of the queue with the reason, and claim refuses", async () => {
    const t = convexTest(schema, modules);
    const id = await reviewable(t, { coverStorageId: "kg2cover" });
    await decide(t, id, "approve");
    expect((await t.query(api.publisher.queue, { token: PUB })).packages.map((p) => p.packageId)).toEqual([id]);
    await release(t, { ...at(trackA!), embargo: { until: "2026-11-07" } });
    const q = await t.query(api.publisher.queue, { token: PUB });
    expect(q.packages).toEqual([]);
    expect(q.held).toEqual([{ packageId: id, reasons: [trackLine(trackA!, "2026-11-07")] }]);
    const err = await errorData(t.mutation(api.publisher.claim, { token: PUB, packageId: id }));
    expect(err.code).toBe("NOT_READY");
    expect(err.message).toContain(trackLine(trackA!, "2026-11-07"));
    expect((await pkg(t, id))!.status).toBe("approved");

    vi.setSystemTime(NOV_7);
    expect((await t.query(api.publisher.queue, { token: PUB })).held).toEqual([]);
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    expect((await pkg(t, id))!.status).toBe("publishing");
  });

  test("a succeeded result marks a matching new or considering release played, never a passed one or another workspace's", async () => {
    const t = convexTest(schema, modules);
    const considering = await release(t, { ...at(trackA!), status: "considering" });
    const passed = await release(t, { ...at(trackB!), status: "passed" });
    const demoRow = await release(t, { ...at(trackC!), workspace: "demo", status: "new" });
    const other = await release(t, { artist: "Nova Reyes", title: "Moonlit Avenue", status: "new" });
    const id = await reviewable(t);
    await decide(t, id, "approve");
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
    const status = async (r: Id<"releases">) => (await t.run((ctx) => ctx.db.get(r)))!.status;
    expect(await status(considering)).toBe("played");
    expect(await status(passed)).toBe("passed");
    expect(await status(demoRow)).toBe("new");
    expect(await status(other)).toBe("new");
  });
});

describe("what the package page and the agent see", () => {
  // A word of the golden description, so a release titled with it blocks through the prose alone.
  const proseWord = goldenDescription().match(/\b[A-Z][a-z]{5,}\b/)![0];

  test("packages.get carries the release ids; agentGet carries the package's own words only (R8)", async () => {
    const t = convexTest(schema, modules);
    const blocker = await release(t, { ...at(trackA!), embargo: { until: "2026-11-07" }, embed: { kind: "album", id: "4242424242" }, bandcampPage: "https://x.bandcamp.com/album/a" });
    await release(t, { artist: trackB!.artist, title: "Another Record", embargo: { until: null } });
    const id = await reviewable(t); // before the prose embargo, which would refuse the submit itself
    const secret = await release(t, { artist: "Secret Artist", title: proseWord.toLowerCase(), embargo: { until: null } });
    const rec = await t.withIdentity(human).query(api.packages.get, { packageId: id, today: "2026-10-30" });
    expect(rec!.embargo).toEqual({
      blocking: [
        { releaseId: blocker, text: trackLine(trackA!, "2026-11-07") },
        { releaseId: secret, text: trackLine({ artist: "Secret Artist", title: proseWord.toLowerCase() }, null) },
      ],
      sameArtist: [trackLine({ artist: trackB!.artist, title: "Another Record" }, null)],
    });
    const view = await t.query(internal.packages.agentGet, { workspace: "real", packageId: id });
    expect(view!.embargo).toEqual({
      blocking: [
        `The track "${trackA!.title}" in your tracklist is embargoed until 2026-11-07.`,
        `The title "${proseWord}" in your description is embargoed (no date known).`,
      ],
    });
    const json = JSON.stringify(view);
    for (const banned of [blocker, secret, "4242424242", "embed", "bandcamp", "releaseId", "sameArtist", "Another Record", "Secret Artist"]) expect(json).not.toContain(banned);
    // The demo login sees no real embargo on its own package.
    const demoId = await reviewable(t, { workspace: "demo", id: "demo-10-2-26" });
    expect((await t.withIdentity(demoUser).query(api.packages.get, { packageId: demoId, today: "2026-10-30" }))!.embargo).toEqual({ blocking: [], sameArtist: [] });
  });

  test("packages.get counts the day the browser sends, and leaves the embargo out when it sends none", async () => {
    const t = convexTest(schema, modules);
    await release(t, { ...at(trackA!), embargo: { until: "2026-11-07" } });
    const id = await reviewable(t);
    const as = t.withIdentity(human);
    expect((await as.query(api.packages.get, { packageId: id, today: "2026-10-30" }))!.embargo!.blocking).toHaveLength(1);
    expect((await as.query(api.packages.get, { packageId: id, today: "2026-11-07" }))!.embargo).toEqual({ blocking: [], sameArtist: [] });
    expect(await as.query(api.packages.get, { packageId: id })).not.toHaveProperty("embargo");
    expect(await errorData(as.query(api.packages.get, { packageId: id, today: "soon" }))).toMatchObject({ code: "BAD_INPUT" });
  });
});

describe("fix round 1: every other path to Mixcloud", () => {
  const live = async (t: T) => {
    const id = await reviewable(t);
    await decide(t, id, "approve");
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
    return id;
  };
  const text = `${goldenDescription()} Moonlit Avenue.`;

  test("Approve update is refused (EMBARGOED) when an embargo arrived after the proposal", async () => {
    const t = convexTest(schema, modules);
    const id = await live(t);
    const p = await t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId: id, description: text });
    const u = (await t.run((ctx) => ctx.db.get(p.ok ? p.id : (null as never))))!;
    await release(t, { artist: "Nova Reyes", title: "Moonlit Avenue", embargo: { until: "2026-11-07" } });
    const r = await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id: u._id, fingerprint: u.fingerprint });
    expect(r).toEqual({ ok: false, code: "EMBARGOED", message: `${DATED}. Approve after that date, or clear the embargo.` });
    expect((await t.run((ctx) => ctx.db.get(u._id)))!.status).toBe("proposed");
  });

  test("an approved update an embargo holds: forPackage names it with the release, and a new proposal is told why", async () => {
    const t = convexTest(schema, modules);
    const id = await live(t);
    const p = await t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId: id, description: text });
    const u = (await t.run((ctx) => ctx.db.get(p.ok ? p.id : (null as never))))!;
    await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id: u._id, fingerprint: u.fingerprint });
    const rel = await release(t, { artist: "Nova Reyes", title: "Moonlit Avenue", embargo: { until: "2026-11-07" } });
    const view = await t.withIdentity(human).query(api.descriptionUpdates.forPackage, { packageId: id, today: "2026-10-30" });
    expect(view!.latest).toMatchObject({ status: "approved", held: [{ releaseId: rel, text: DATED }] });
    const again = await t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId: id, description: `${goldenDescription()} Again.` });
    expect(again).toMatchObject({ ok: false, code: "NOT_READY", message: expect.stringContaining("An approved update is waiting on an embargo") });
    expect((await t.withIdentity(human).query(api.descriptionUpdates.forPackage, { packageId: id, today: "2026-11-07" }))!.latest).not.toHaveProperty("held");
  });

  test("the internal claimForPublish is held too", async () => {
    const t = convexTest(schema, modules);
    const id = await reviewable(t);
    await decide(t, id, "approve");
    await release(t, { ...at(trackA!), embargo: { until: null } });
    expect(await errorData(t.mutation(internal.packages.claimForPublish, { packageId: id }))).toMatchObject({ code: "NOT_READY" });
    expect((await pkg(t, id))!.status).toBe("approved");
  });

  test("confirmPosted (an uncertain upload that is on Mixcloud) marks matching releases played", async () => {
    const t = convexTest(schema, modules);
    const considering = await release(t, { ...at(trackA!), status: "considering" });
    const passed = await release(t, { ...at(trackB!), status: "passed" });
    const id = await reviewable(t);
    await decide(t, id, "approve");
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "outcome_unknown" } });
    expect((await t.run((ctx) => ctx.db.get(considering)))!.status).toBe("considering");
    expect(await t.withIdentity(human).mutation(api.packages.confirmPosted, { packageId: id, url: URL_ })).toMatchObject({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(considering)))!.status).toBe("played");
    expect((await t.run((ctx) => ctx.db.get(passed)))!.status).toBe("passed");
  });
});
