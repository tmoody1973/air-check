// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Listening-queue brief B and B2: radar.reparse (INBOX_TOKEN) repairs a release stored by the old Bandcamp parser and
// re-queues its page so the date reader runs. It touches artist, title and label only, never a field Tarik edited.
const modules = import.meta.glob("./**/*.*s");
const INBOX = "x".repeat(48);
const INGEST = "i".repeat(48);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const PAGE = "https://acidjazz.bandcamp.com/album/peace-love";
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("INBOX_TOKEN", INBOX);
  vi.stubEnv("INGEST_TOKEN", INGEST);
});
afterEach(() => vi.unstubAllEnvs());

const mail = (over: Record<string, unknown> = {}) => ({
  tab: "bandcamp",
  sender: { name: "Bandcamp", address: "noreply@bandcamp.example.invalid" },
  subject: "New release from Acid Jazz Records",
  body: "Acid Jazz Records just released the record",
  links: [PAGE],
  bandcampPages: [PAGE],
  hosts: [],
  ...over,
});
/** A release as the old parser stored it. */
const BUGGY = { artist: "Roots Records, check it out at:", title: "Peace & Love / Adapter Chapter", label: "Acid Jazz Records" };
const FIXED = { artist: "Roots Records", title: "Peace & Love / Adapter Chapter", label: "Acid Jazz Records" };

async function saved(t: T, messageId: string, release: Record<string, unknown> = BUGGY, m = mail()) {
  await t.mutation(api.radar.received, { token: INBOX, messageId, receivedAt: Date.UTC(2026, 9, 29, 15), from: "tarik@radiomilwaukee.org", subject: "New release", mail: m } as never);
  const r = await t.mutation(api.radar.record, { token: INGEST, messageId, outcome: { kind: "saved", release } } as never);
  return r.releaseId as Id<"releases">;
}
const reparse = (t: T, messageId: string, fields: Record<string, unknown> = FIXED, extra: Record<string, unknown> = {}) =>
  t.mutation(api.radar.reparse, { token: INBOX, messageId, fields, ...extra } as never);
const get = async (t: T, id: Id<"releases">) => (await t.run((ctx) => ctx.db.get(id)))!;
const ready = (t: T, id: Id<"releases">) => t.run((ctx) => ctx.db.patch(id, { embedState: "ready", embed: { kind: "album", id: "111" } }));
const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
  return "no error";
};

describe("radar.reparse", () => {
  test("repaired: artist, title and label patched; key and searchText recomputed; a second run is unchanged", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1");
    expect(await reparse(t, "m1")).toEqual({ result: "repaired", requeued: false });
    expect(await get(t, id)).toMatchObject({ ...FIXED, key: "roots records|peace love adapter chapter", searchText: "roots records peace love adapter chapter acid jazz records" });
    expect(await reparse(t, "m1")).toEqual({ result: "unchanged", requeued: false });
  });

  test("not-found: no release names that email, or only a demo one does", async () => {
    const t = convexTest(schema, modules);
    await saved(t, "m1");
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "demo", artist: "[A]", title: "[T]", source: "bandcamp", senders: [{ messageId: "m-demo", at: 1 }] }));
    expect(await reparse(t, "m-none")).toEqual({ result: "not-found", requeued: false });
    expect(await reparse(t, "m-demo")).toEqual({ result: "not-found", requeued: false });
  });

  test("collision: the new key belongs to another release, so both are left untouched (and nothing is re-queued)", async () => {
    const t = convexTest(schema, modules);
    const a = await saved(t, "m1");
    const b = await saved(t, "m2", FIXED);
    await ready(t, a);
    const before = [await get(t, a), await get(t, b)];
    expect(await reparse(t, "m1")).toEqual({ result: "collision", requeued: false });
    expect([await get(t, a), await get(t, b)]).toEqual(before);
  });

  test("a field Tarik edited is never patched", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1");
    await t.withIdentity(human).mutation(api.radar.edit, { releaseId: id, fields: { label: "My Label" } });
    await reparse(t, "m1", { ...FIXED, label: "Acid Jazz Records" });
    expect(await get(t, id)).toMatchObject({ artist: "Roots Records", label: "My Label" });
    await t.run((ctx) => ctx.db.patch(id, { editedFields: ["label", "artist", "title"] }));
    expect(await reparse(t, "m1", { artist: "Other", title: "Other" })).toEqual({ result: "unchanged", requeued: false });
  });

  test("no label in the parse: the old parser's sender-as-label is cleared; any other label stays", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1", { artist: "Stand", title: "Me", label: "Lyric Jones" });
    await reparse(t, "m1", { artist: "Lyric Jones", title: "Stand by Me" });
    expect(await get(t, id)).toMatchObject({ artist: "Lyric Jones", title: "Stand by Me" });
    expect(await get(t, id)).not.toHaveProperty("label");
    const id2 = await saved(t, "m2", { artist: "Hiro Ama, x", title: "Cloud 9", label: "Total Records" });
    await reparse(t, "m2", { artist: "Hiro Ama", title: "Cloud 9" });
    expect(await get(t, id2)).toMatchObject({ artist: "Hiro Ama", label: "Total Records" });
  });

  test("--dry-run: the same answer, nothing written", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1");
    await ready(t, id);
    const before = await get(t, id);
    expect(await reparse(t, "m1", FIXED, { dryRun: true })).toEqual({ result: "repaired", requeued: true });
    expect(await get(t, id)).toEqual(before);
  });

  test("INBOX_TOKEN only; fields are checked like any release", async () => {
    const t = convexTest(schema, modules);
    await saved(t, "m1");
    expect(await errorCode(t.mutation(api.radar.reparse, { token: INGEST, messageId: "m1", fields: FIXED }))).toBe("UNAUTHORIZED");
    expect(await errorCode(t.withIdentity(human).mutation(api.radar.reparse, { token: "nope", messageId: "m1", fields: FIXED }))).toBe("UNAUTHORIZED");
    for (const bad of [{ artist: "https://evil.example", title: "T" }, { artist: " ", title: "T" }, { artist: "A", title: "x".repeat(201) }, { artist: "A", title: "T", label: "a@b.c" }])
      expect(await errorCode(reparse(t, "m1", bad))).toBe("BAD_INPUT");
    expect(await errorCode(reparse(t, "m1", { ...FIXED, status: "played" }))).not.toBe("no error");
  });
});

describe("radar.reparse re-queues a ready Bandcamp page that has no release date (B2)", () => {
  test("ready + page + no date: queued again, the old player kept until the page is read", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1");
    await ready(t, id);
    expect(await reparse(t, "m1")).toEqual({ result: "repaired", requeued: true });
    const r = await get(t, id);
    expect(r).toMatchObject({ embedState: "queued", embed: { kind: "album", id: "111" } });
    expect(r.embedQueuedAt).toEqual(expect.any(Number));
    // An unchanged release is re-queued too, once it is ready again.
    await ready(t, id);
    expect(await reparse(t, "m1")).toEqual({ result: "unchanged", requeued: true });
  });

  test("not re-queued: a date already set, a failed or queued player, no page, or a co-sign", async () => {
    const t = convexTest(schema, modules);
    const dated = await saved(t, "m1", { ...BUGGY, releasedOn: "2026-10-29" });
    await ready(t, dated);
    expect((await reparse(t, "m1")).requeued).toBe(false);
    const failed = await saved(t, "m2", { artist: "B", title: "C" });
    await t.run((ctx) => ctx.db.patch(failed, { embedState: "failed", embedError: "timeout" }));
    expect((await reparse(t, "m2", { artist: "B", title: "C" })).requeued).toBe(false);
    const queued = await saved(t, "m3", { artist: "D", title: "E" });
    expect((await reparse(t, "m3", { artist: "D", title: "E" })).requeued).toBe(false);
    const nopage = await saved(t, "m4", { artist: "F", title: "G" }, mail({ links: [], bandcampPages: [] }));
    await t.run((ctx) => ctx.db.patch(nopage, { embedState: "ready", embed: { kind: "album", id: "1" } }));
    expect((await reparse(t, "m4", { artist: "F", title: "G" })).requeued).toBe(false);
    const cosign = await saved(t, "m5", { artist: "H", title: "I" }, mail({ tab: "cosign" }));
    await ready(t, cosign);
    expect((await reparse(t, "m5", { artist: "H", title: "I" })).requeued).toBe(false);
  });

  test("the re-fetch: success fills the date (fill-only); a failure keeps the working player ready", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1");
    await ready(t, id);
    await reparse(t, "m1");
    await t.mutation(api.radar.embedResult, { token: INGEST, releaseId: id, pageUrl: PAGE, result: { failed: "timeout" } });
    expect(await get(t, id)).toMatchObject({ embedState: "ready", embed: { kind: "album", id: "111" } });
    expect(await get(t, id)).not.toHaveProperty("embedError");
    await reparse(t, "m1");
    await t.mutation(api.radar.embedResult, { token: INGEST, releaseId: id, pageUrl: PAGE, result: { kind: "album", id: "222", releasedOn: "2026-10-24" } });
    expect(await get(t, id)).toMatchObject({ embedState: "ready", embed: { kind: "album", id: "222" }, releasedOn: "2026-10-24" });
  });

  test("a first fetch that fails still fails (no player to keep)", async () => {
    const t = convexTest(schema, modules);
    const id = await saved(t, "m1");
    await t.mutation(api.radar.embedResult, { token: INGEST, releaseId: id, pageUrl: PAGE, result: { failed: "timeout" } });
    expect(await get(t, id)).toMatchObject({ embedState: "failed", embedError: "timeout" });
  });
});
