import { createHash } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { type Actor, ApprovalGate, canPublish, fingerprint, GateError, toSections, type Transition } from "../src/index";
import { goldenDraft } from "./helpers/goldens";
import { memoryStore } from "./helpers/memory-store";

const tarik: Actor = { kind: "human", userId: "u1", email: "tarik@radiomilwaukee.org" };
let transitions: Transition[];
let gate: ApprovalGate;

beforeEach(() => {
  transitions = [];
  gate = new ApprovalGate(memoryStore(), { onTransition: async (t) => void transitions.push(t) });
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof GateError ? e.code : `not a GateError: ${String(e)}`;
  }
  return "no error";
};

const MP3 = "a".repeat(64);
const judge: Actor = { kind: "demo", userId: "judge" };

async function ready(overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const rec = await gate.submit(goldenDraft(overrides));
  const { hour1Id, hour2Id } = rec.draft.audio;
  const withAudio = await gate.attachAudio(rec.draft.id, { hour1Id, hour2Id, mp3Sha256: MP3 });
  return { id: rec.draft.id, fp: withAudio.fingerprint! };
}

test("cannot approve before audio exists", async () => {
  const draft = goldenDraft({ audio: { hour1Id: "h1", hour2Id: "h2" } });
  const rec = await gate.submit(draft);
  expect(rec.status).toBe("preparing_audio");
  expect(await code(gate.decide(rec.draft.id, "anything", "approve", tarik))).toBe("NOT_READY");
  const withAudio = await gate.attachAudio(rec.draft.id, { hour1Id: "h1", hour2Id: "h2", mp3Sha256: "b".repeat(64) });
  expect(withAudio.status).toBe("awaiting_review");
  expect(withAudio.fingerprint).toBe(await fingerprint({ ...draft, audio: { ...draft.audio, mp3Sha256: "b".repeat(64) } }));
});

test("agent cannot approve", async () => {
  const { id, fp } = await ready();
  expect(await code(gate.decide(id, fp, "approve", { kind: "agent" }))).toBe("FORBIDDEN");
});

test("outside domain cannot approve", async () => {
  const { id, fp } = await ready();
  for (const email of ["x@gmail.com", "x@notradiomilwaukee.org", "x@radiomilwaukee.org.evil.com"])
    expect(await code(gate.decide(id, fp, "approve", { kind: "human", userId: "u2", email }))).toBe("FORBIDDEN");
  const upper = await gate.decide(id, fp, "approve", { kind: "human", userId: "u1", email: "Tarik@RadioMilwaukee.org" });
  expect(upper.status).toBe("approved");
});

test("changed package cannot be approved with old fingerprint", async () => {
  const { id, fp } = await ready();
  const revised = await gate.revise(id, goldenDraft({ title: "RLR 10.2.26 | Bicep, Tinashe, Actress, ISHA and more" }));
  expect(revised.fingerprint).not.toBe(fp);
  expect(await code(gate.decide(id, fp, "approve", tarik))).toBe("PACKAGE_CHANGED");
  expect((await gate.decide(id, revised.fingerprint!, "approve", tarik)).status).toBe("approved");
});

test("concurrent approvals claim once", async () => {
  const { id, fp } = await ready();
  const [a, b] = await Promise.all([gate.decide(id, fp, "approve", tarik), gate.decide(id, fp, "approve", tarik)]);
  expect([a.status, b.status]).toEqual(["approved", "approved"]);
  expect(transitions.filter((t) => t.to === "approved")).toHaveLength(1);
  const [c1, c2] = await Promise.all([gate.claimForPublish(id), gate.claimForPublish(id)]);
  expect([c1, c2].filter(Boolean)).toHaveLength(1);
});

test("skip is final", async () => {
  const { id, fp } = await ready();
  expect((await gate.decide(id, fp, "skip", tarik)).status).toBe("skipped");
  const again = await gate.decide(id, fp, "approve", tarik);
  expect(again.status).toBe("skipped");
  expect(canPublish(again)).toBe(false);
  expect(await gate.claimForPublish(id)).toBeNull();
});

test("demo package never publishes", async () => {
  const { id, fp } = await ready({ workspace: "demo" });
  const approved = await gate.decide(id, fp, "approve", judge);
  expect(approved.status).toBe("approved");
  expect(canPublish(approved)).toBe(false);
  expect(await code(gate.claimForPublish(id))).toBe("DEMO_CANNOT_PUBLISH");
});

test("demo actor can decide demo packages only", async () => {
  const real = await ready();
  expect(await code(gate.decide(real.id, real.fp, "approve", judge))).toBe("FORBIDDEN");
});

test("revise cannot change the workspace", async () => {
  const { id } = await ready({ workspace: "demo" });
  const revised = await gate.revise(id, goldenDraft({ workspace: "real", title: "RLR 10.2.26 | A, B, C, D and more" }));
  expect(revised.draft.workspace).toBe("demo");
  expect(await code(gate.claimForPublish(id))).toBe("DEMO_CANNOT_PUBLISH");
});

test("fingerprint covers the workspace", async () => {
  expect(await fingerprint(goldenDraft({ workspace: "demo" }))).not.toBe(await fingerprint(goldenDraft()));
});

test("the agent cannot supply the MP3 hash", async () => {
  const rec = await gate.submit(goldenDraft()); // goldenDraft carries an mp3Sha256
  expect(rec.status).toBe("preparing_audio");
  expect(rec.draft.audio.mp3Sha256).toBeUndefined();
  expect(await code(gate.decide(rec.draft.id, await fingerprint(goldenDraft()), "approve", tarik))).toBe("NOT_READY");
});

test("revise never takes an MP3 hash from the draft", async () => {
  const { id } = await ready();
  const moved = await gate.revise(id, goldenDraft({ audio: { hour1Id: "NEW1", hour2Id: "NEW2", mp3Sha256: "f".repeat(64) } }));
  expect(moved.status).toBe("preparing_audio");
  expect(moved.draft.audio.mp3Sha256).toBeUndefined();
});

test("attachAudio refuses an MP3 made from other hours", async () => {
  const { id } = await ready();
  await gate.revise(id, goldenDraft({ audio: { hour1Id: "NEW1", hour2Id: "NEW2" } }));
  expect(await code(gate.attachAudio(id, { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: MP3 }))).toBe(
    "PACKAGE_CHANGED",
  );
  expect((await gate.attachAudio(id, { hour1Id: "NEW1", hour2Id: "NEW2", mp3Sha256: MP3 })).status).toBe("awaiting_review");
});

test("outcome_unknown is never re-claimed", async () => {
  const { id, fp } = await ready();
  await gate.decide(id, fp, "approve", tarik);
  expect(await gate.claimForPublish(id)).not.toBeNull();
  expect((await gate.recordResult(id, { status: "outcome_unknown" })).status).toBe("outcome_unknown");
  expect(await gate.claimForPublish(id)).toBeNull();
});

test("resubmitting an existing package id is refused", async () => {
  const { id, fp } = await ready();
  await gate.decide(id, fp, "approve", tarik);
  expect(await code(gate.submit(goldenDraft({ title: "something else" })))).toBe("ALREADY_EXISTS");
  expect(canPublish((await gate.claimForPublish(id))!)).toBe(false); // now publishing, not reset
});

test("transitions record who acted", async () => {
  const { id, fp } = await ready();
  await gate.decide(id, fp, "approve", tarik);
  await gate.claimForPublish(id);
  await gate.recordResult(id, { status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/x/" });
  expect(transitions.map((t) => [t.from, t.to, t.by])).toEqual([
    [null, "preparing_audio", "agent"],
    ["preparing_audio", "awaiting_review", "media"],
    ["awaiting_review", "approved", "tarik@radiomilwaukee.org"],
    ["approved", "publishing", "publisher"],
    ["publishing", "succeeded", "publisher"],
  ]);
});

test("fingerprint covers the mp3", async () => {
  const a = goldenDraft();
  const b = goldenDraft({ audio: { ...a.audio, mp3Sha256: "c".repeat(64) } });
  expect(await fingerprint(a)).not.toBe(await fingerprint(b));
  await expect(fingerprint(goldenDraft({ audio: { hour1Id: "h1", hour2Id: "h2" } }))).rejects.toThrow();
});

test("fingerprint is stable across key order", async () => {
  const a = goldenDraft();
  const reordered = { ...a, audio: { mp3Sha256: a.audio.mp3Sha256, hour2Id: a.audio.hour2Id, hour1Id: a.audio.hour1Id } };
  expect(await fingerprint(reordered)).toBe(await fingerprint(a));
});

test("fingerprint is identical to the node:crypto value", async () => {
  const d = goldenDraft();
  // the fixed shape and key order below is what the gate has always hashed; node:crypto is used here only
  const canonical = JSON.stringify({
    description: d.description,
    hour1Id: d.audio.hour1Id,
    hour2Id: d.audio.hour2Id,
    mp3Sha256: d.audio.mp3Sha256,
    picture: d.picture,
    sections: toSections(d.tracks),
    tags: d.tags,
    title: d.title,
    workspace: d.workspace,
  });
  expect(await fingerprint(d)).toBe(createHash("sha256").update(canonical).digest("hex"));
});

test("hour-1 length does not change the fingerprint", async () => {
  const a = goldenDraft();
  const b = goldenDraft({ audio: { ...a.audio, hour1DurationSec: 3601 } });
  expect(await fingerprint(b)).toBe(await fingerprint(a));
});

test("hour-1 length is stored with the MP3 and dropped when the audio is redone", async () => {
  const rec = await gate.submit(goldenDraft());
  const { hour1Id, hour2Id } = rec.draft.audio;
  const withAudio = await gate.attachAudio(rec.draft.id, { hour1Id, hour2Id, mp3Sha256: MP3, hour1DurationSec: 3601 });
  expect(withAudio.draft.audio.hour1DurationSec).toBe(3601);
  const same = await gate.revise(rec.draft.id, goldenDraft());
  expect(same.draft.audio.hour1DurationSec).toBe(3601);
  const other = await gate.revise(rec.draft.id, goldenDraft({ audio: { hour1Id: "x", hour2Id } }));
  expect(other.draft.audio.hour1DurationSec).toBeUndefined();
});

test("flags and alternates are display-only: the fingerprint ignores them", async () => {
  const base = goldenDraft();
  const withMp3 = { ...base, audio: { ...base.audio, mp3Sha256: MP3 } };
  expect(await fingerprint({ ...withMp3, flags: ["x"] })).toBe(await fingerprint(withMp3));
  expect(await fingerprint({ ...withMp3, alternates: ["y"] })).toBe(await fingerprint(withMp3));
});

// Plan 5 Task 2: cover art, MP3 size, result time.
const COVER = "kg2cover0000000000000000000000000";

test("a draft with no cover keeps today's fingerprint; a cover changes it", async () => {
  const d = goldenDraft();
  expect(await fingerprint({ ...d, coverStorageId: undefined })).toBe(await fingerprint(d));
  expect(await fingerprint({ ...d, coverStorageId: COVER })).not.toBe(await fingerprint(d));
});

test("MP3 size is stored with the audio but not fingerprinted", async () => {
  const rec = await gate.submit(goldenDraft());
  const { hour1Id, hour2Id } = rec.draft.audio;
  const withAudio = await gate.attachAudio(rec.draft.id, { hour1Id, hour2Id, mp3Sha256: MP3, mp3Bytes: 1234 });
  expect(withAudio.draft.audio.mp3Bytes).toBe(1234);
  expect(withAudio.fingerprint).toBe(await fingerprint({ ...withAudio.draft, audio: { hour1Id, hour2Id, mp3Sha256: MP3 } }));
  expect((await gate.revise(rec.draft.id, goldenDraft())).draft.audio.mp3Bytes).toBe(1234);
});

test("setCover: a human sets and clears the cover while awaiting review, and it re-fingerprints", async () => {
  const { id, fp } = await ready();
  const set = await gate.setCover(id, COVER, tarik);
  expect(set.draft.coverStorageId).toBe(COVER);
  expect(set.status).toBe("awaiting_review");
  expect(set.fingerprint).toBe(await fingerprint(set.draft));
  expect(set.fingerprint).not.toBe(fp);
  expect(await code(gate.decide(id, fp, "approve", tarik))).toBe("PACKAGE_CHANGED");
  const cleared = await gate.setCover(id, null, tarik);
  expect(cleared.draft.coverStorageId).toBeUndefined();
  expect(cleared.fingerprint).toBe(fp);
});

test("setCover: only a signed-in human, only while awaiting review", async () => {
  const { id, fp } = await ready();
  expect(await code(gate.setCover(id, COVER, { kind: "agent" }))).toBe("FORBIDDEN");
  expect(await code(gate.setCover(id, COVER, judge))).toBe("FORBIDDEN");
  await gate.decide(id, fp, "approve", tarik);
  expect(await code(gate.setCover(id, COVER, tarik))).toBe("NOT_READY");
  const pending = await gate.submit(goldenDraft({ id: "pkg-x" }));
  expect(await code(gate.setCover(pending.draft.id, COVER, tarik))).toBe("NOT_READY");
});

test("the agent cannot set the cover through submit or revise", async () => {
  const rec = await gate.submit(goldenDraft({ coverStorageId: "agent-cover" }));
  expect(rec.draft.coverStorageId).toBeUndefined();
  const { hour1Id, hour2Id } = rec.draft.audio;
  await gate.attachAudio(rec.draft.id, { hour1Id, hour2Id, mp3Sha256: MP3 });
  await gate.setCover(rec.draft.id, COVER, tarik);
  const revised = await gate.revise(rec.draft.id, goldenDraft({ coverStorageId: "agent-cover" }));
  expect(revised.draft.coverStorageId).toBe(COVER);
});

test("recordResult stamps when the result arrived", async () => {
  const at = new Date("2026-10-28T15:00:00Z");
  const timed = new ApprovalGate(memoryStore(), { now: () => at });
  const rec = await timed.submit(goldenDraft());
  const { hour1Id, hour2Id } = rec.draft.audio;
  const { fingerprint: fp } = await timed.attachAudio(rec.draft.id, { hour1Id, hour2Id, mp3Sha256: MP3 });
  await timed.decide(rec.draft.id, fp!, "approve", tarik);
  await timed.claimForPublish(rec.draft.id);
  const done = await timed.recordResult(rec.draft.id, { status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/x/" });
  expect(done.result).toEqual({ url: "https://www.mixcloud.com/rhythmlab/x/", at: at.toISOString() });
});

test("unclaim: publishing -> approved only, after Mixcloud refused the key (nothing was posted)", async () => {
  const { id, fp } = await ready();
  expect(await code(gate.unclaim(id, "invalid_token"))).toBe("NOT_READY"); // awaiting review
  await gate.decide(id, fp, "approve", tarik);
  expect(await code(gate.unclaim(id, "invalid_token"))).toBe("NOT_READY"); // approved, never claimed
  await gate.claimForPublish(id);
  const back = await gate.unclaim(id, "invalid_token");
  expect(back.status).toBe("approved");
  expect(back.fingerprint).toBe(fp); // still the version Tarik approved
  expect(transitions.at(-1)).toMatchObject({ id, from: "publishing", to: "approved", by: "publisher" });
  expect(await gate.claimForPublish(id)).not.toBeNull(); // queued again once reconnected
  await gate.recordResult(id, { status: "outcome_unknown" });
  expect(await code(gate.unclaim(id, "invalid_token"))).toBe("NOT_READY"); // a result is final
  expect(await code(gate.unclaim("nope", "invalid_token"))).toBe("NOT_READY");
});

// I2: failed and outcome_unknown are not dead ends. A human reopens (back to review, approve again) or confirms the post.
const URL_OK = "https://www.mixcloud.com/rhythmlab/rlr-10-2-26/";
async function settled(r: "failed" | "outcome_unknown") {
  const { id, fp } = await ready({ id: `pkg-${r}` });
  await gate.decide(id, fp, "approve", tarik);
  await gate.claimForPublish(id);
  await gate.recordResult(id, r === "failed" ? { status: "failed", error: "audio changed since approval" } : { status: "outcome_unknown" });
  return { id, fp };
}

test("reopen: failed or outcome_unknown -> awaiting_review, cleared and re-fingerprinted; Approve is needed again", async () => {
  for (const r of ["failed", "outcome_unknown"] as const) {
    const { id } = await settled(r);
    const back = await gate.reopen(id, tarik);
    expect(back.status).toBe("awaiting_review");
    expect(back.result).toBeUndefined();
    expect(back.decidedBy).toBeUndefined();
    expect(back.decidedAt).toBeUndefined();
    expect(back.fingerprint).toBe(await fingerprint(back.draft));
    expect(transitions.at(-1)).toMatchObject({ id, from: r, to: "awaiting_review", by: "tarik@radiomilwaukee.org" });
    expect(await gate.claimForPublish(id)).toBeNull(); // Hard Rule 1: reopening never yields approved
    const again = await gate.decide(id, back.fingerprint!, "approve", tarik);
    expect(again.status).toBe("approved");
  }
});

test("reopen: only from failed or outcome_unknown, only a real-workspace human", async () => {
  const { id, fp } = await ready();
  expect(await code(gate.reopen(id, tarik))).toBe("NOT_READY"); // awaiting review
  await gate.decide(id, fp, "approve", tarik);
  expect(await code(gate.reopen(id, tarik))).toBe("NOT_READY"); // approved
  await gate.claimForPublish(id);
  expect(await code(gate.reopen(id, tarik))).toBe("NOT_READY"); // publishing
  await gate.recordResult(id, { status: "succeeded", url: URL_OK });
  expect(await code(gate.reopen(id, tarik))).toBe("NOT_READY"); // succeeded is final
  expect(await code(gate.reopen("nope", tarik))).toBe("NOT_FOUND");
});

test("reopen and confirmPosted refuse the agent, the demo login and outside domains", async () => {
  const { id } = await settled("outcome_unknown");
  for (const actor of [{ kind: "agent" } as Actor, judge, { kind: "human", userId: "u2", email: "x@gmail.com" } as Actor]) {
    expect(await code(gate.reopen(id, actor))).toBe("FORBIDDEN");
    expect(await code(gate.confirmPosted(id, URL_OK, actor))).toBe("FORBIDDEN");
  }
});

test("confirmPosted: outcome_unknown -> succeeded with the URL, stamped now (counts toward that day's pacing)", async () => {
  const at = new Date("2026-10-28T15:00:00Z");
  const timed = new ApprovalGate(memoryStore(), { now: () => at, onTransition: async (t) => void transitions.push(t) });
  const rec = await timed.submit(goldenDraft());
  const { hour1Id, hour2Id } = rec.draft.audio;
  const { fingerprint: fp } = await timed.attachAudio(rec.draft.id, { hour1Id, hour2Id, mp3Sha256: MP3 });
  const id = rec.draft.id;
  await timed.decide(id, fp!, "approve", tarik);
  expect(await code(timed.confirmPosted(id, URL_OK, tarik))).toBe("NOT_READY"); // approved
  await timed.claimForPublish(id);
  await timed.recordResult(id, { status: "outcome_unknown" });
  for (const bad of ["http://www.mixcloud.com/x/", "https://mixcloud.com/x/", "https://www.mixcloud.com.evil.com/x", "javascript:alert(1)", ""])
    expect(await code(timed.confirmPosted(id, bad, tarik))).toBe("BAD_INPUT");
  const done = await timed.confirmPosted(id, URL_OK, tarik);
  expect(done.status).toBe("succeeded");
  expect(done.result).toEqual({ url: URL_OK, at: at.toISOString() });
  expect(transitions.at(-1)).toMatchObject({ id, from: "outcome_unknown", to: "succeeded", by: "tarik@radiomilwaukee.org" });
  expect(await code(timed.confirmPosted(id, URL_OK, tarik))).toBe("NOT_READY"); // already succeeded
});

test("confirmPosted: a failed upload cannot be marked posted (it was refused, so it is not up)", async () => {
  const { id } = await settled("failed");
  expect(await code(gate.confirmPosted(id, URL_OK, tarik))).toBe("NOT_READY");
});
