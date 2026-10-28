import { describe, expect, test } from "vitest";
import { chicagoDayKey, matchInbox, nextToPublish, publishDayOffset, readyCard, validateForUpload } from "../src/index";
import { goldenDraft } from "./helpers/goldens";

describe("matchInbox", () => {
  test("orders by leading digits", () => {
    expect(matchInbox("2026-10-02", ["9126.wav", "9125.wav"])).toEqual({ ok: true, showDate: "2026-10-02", hour1: "9125.wav", hour2: "9126.wav" });
  });
  test("numeric not lexical", () => {
    const r = matchInbox("2026-10-02", ["10000.wav", "9999.wav"]);
    expect(r).toMatchObject({ ok: true, hour1: "9999.wav" });
  });
  test("no digits: lexical, case-insensitive extension", () => {
    expect(matchInbox("2026-10-02", ["B.WAV", "a.wav"])).toMatchObject({ ok: true, hour1: "a.wav", hour2: "B.WAV" });
  });
  test("ignores other files", () => {
    expect(matchInbox("2026-10-02", ["1.wav", "2.wav", "notes.txt"])).toMatchObject({ ok: true });
  });
  test("one file", () => {
    expect(matchInbox("2026-10-02", ["1.wav"])).toEqual({ ok: false, reason: "2026-10-02 needs exactly two .wav files; found 1" });
  });
  test("three files", () => {
    expect(matchInbox("2026-10-02", ["1.wav", "2.wav", "3.wav"])).toMatchObject({ ok: false, reason: expect.stringContaining("found 3") });
  });
  test("equal keys", () => {
    expect(matchInbox("2026-10-02", ["07.wav", "7.wav"])).toMatchObject({ ok: false, reason: expect.stringMatching(/same|equal/i) });
  });
  test("bad folder name", () => {
    expect(matchInbox("oct 2", ["1.wav", "2.wav"])).toMatchObject({ ok: false, reason: expect.stringContaining("oct 2") });
    expect(matchInbox("2026-13-40", ["1.wav", "2.wav"])).toMatchObject({ ok: false });
  });
});

describe("nextToPublish", () => {
  const a = (packageId: string, showDate: string, approvedAt = "2026-10-20T00:00:00Z") => ({ packageId, showDate, approvedAt });
  const three = [a("c", "2026-10-09"), a("a", "2026-10-02"), a("b", "2026-10-02", "2026-10-21T00:00:00Z")];
  test("oldest first, ties by approvedAt", () => {
    expect(nextToPublish(three, 0)).toEqual({ packageId: "a" });
  });
  test("waits once the day is full", () => {
    expect(nextToPublish(three, 3)).toEqual({ waitUntil: "tomorrow" });
  });
  test("empty is null", () => {
    expect(nextToPublish([], 0)).toBeNull();
  });
  test("does not mutate input", () => {
    const copy = [...three];
    nextToPublish(three, 0);
    expect(three).toEqual(copy);
  });
});

describe("publishDayOffset", () => {
  const four = ["d", "c", "b", "a"].map((id, i) => ({ packageId: id, showDate: `2026-10-0${4 - i}`, approvedAt: "2026-10-20T00:00:00Z" }));
  // oldest first: a, b, c, d
  test("first three today, fourth tomorrow", () => {
    expect(["a", "b", "c", "d"].map((id) => publishDayOffset(four, 0, id))).toEqual([0, 0, 0, 1]);
  });
  test("already published today pushes to tomorrow", () => {
    expect(publishDayOffset(four, 3, "a")).toBe(1);
  });
  test("unknown id", () => {
    expect(publishDayOffset(four, 0, "zzz")).toBeNull();
  });
});

describe("chicagoDayKey", () => {
  test("CDT evening is still the same Chicago day", () => {
    expect(chicagoDayKey(Date.parse("2026-10-03T04:59:59Z"))).toBe("2026-10-02");
    expect(chicagoDayKey(Date.parse("2026-10-03T05:00:00Z"))).toBe("2026-10-03");
  });
  test("CST midnight is 06:00Z", () => {
    expect(chicagoDayKey(Date.parse("2026-12-03T05:59:59Z"))).toBe("2026-12-02");
    expect(chicagoDayKey(Date.parse("2026-12-03T06:00:00Z"))).toBe("2026-12-03");
  });
  test("DST change day", () => {
    expect(chicagoDayKey(Date.parse("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(chicagoDayKey(Date.parse("2026-11-02T05:59:00Z"))).toBe("2026-11-01");
  });
});

describe("validateForUpload", () => {
  const ok = { mp3Bytes: 200 * 1024 ** 2 };
  test("golden draft is fine", () => {
    expect(validateForUpload(goldenDraft(), ok)).toEqual([]);
  });
  test("1,001-char description", () => {
    expect(validateForUpload(goldenDraft({ description: "x".repeat(1001) }), ok)).toHaveLength(1);
    expect(validateForUpload(goldenDraft({ description: "x".repeat(1000) }), ok)).toEqual([]);
  });
  test("counts code points", () => {
    expect(validateForUpload(goldenDraft({ description: "🎵".repeat(1000) }), ok)).toEqual([]);
  });
  test("6 tags", () => {
    expect(validateForUpload(goldenDraft({ tags: ["a", "b", "c", "d", "e", "f"] }), ok)).toHaveLength(1);
  });
  test("empty tags are not counted", () => {
    expect(validateForUpload(goldenDraft({ tags: ["a", "b", "c", "d", "e", " ", ""] }), ok)).toEqual([]);
  });
  test("name empty or too long", () => {
    expect(validateForUpload(goldenDraft({ title: "  " }), ok)).toHaveLength(1);
    expect(validateForUpload(goldenDraft({ title: "t".repeat(101) }), ok)).toHaveLength(1);
    expect(validateForUpload(goldenDraft({ title: "t".repeat(100) }), ok)).toEqual([]);
  });
  test("section missing artist or song", () => {
    const d = goldenDraft();
    const tracks = d.tracks.map((t, i) => (i === 2 ? { ...t, artist: " " } : t));
    expect(validateForUpload({ ...d, tracks }, ok)).toHaveLength(1);
  });
  test("mp3 over 4 GB", () => {
    expect(validateForUpload(goldenDraft(), { mp3Bytes: 4.1 * 1024 ** 3 })).toHaveLength(1);
    expect(validateForUpload(goldenDraft(), { mp3Bytes: 4 * 1024 ** 3 })).toEqual([]);
  });
  test("picture over 10 MB", () => {
    expect(validateForUpload(goldenDraft(), { ...ok, pictureBytes: 10 * 1024 ** 2 + 1 })).toHaveLength(1);
    expect(validateForUpload(goldenDraft(), { ...ok, pictureBytes: 10 * 1024 ** 2 })).toEqual([]);
  });
});

describe("readyCard", () => {
  const card = readyCard({ title: "Rhythm Lab Radio 10-2-26", trackCount: 31, flagCount: 0, packageId: "pkg1", appUrl: "https://app.example" });
  test("has title, counts, link", () => {
    expect(card).toContain("Rhythm Lab Radio 10-2-26");
    expect(card).toContain("31 tracks · 0 flags");
    expect(card).toContain("Review package: https://app.example/packages/pkg1");
  });
  test("never says approve", () => {
    expect(card).not.toMatch(/approve/i);
  });
  test("singular and trailing slash", () => {
    const c = readyCard({ title: "T", trackCount: 1, flagCount: 1, packageId: "p", appUrl: "https://x/" });
    expect(c).toContain("1 track · 1 flag");
    expect(c).toContain("https://x/packages/p");
  });
});
