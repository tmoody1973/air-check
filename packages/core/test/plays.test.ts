import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lastPlayed, PLAYS_URL, researchCard } from "../src/index";

// Plan 7 Task 5: the one client for station play history (rm-playlist-v2's public read-only queries, spike V7).
const NOW = Date.UTC(2026, 9, 29, 14); // Oct 29, 9 am in Chicago
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const play = (artist: string, playedAt: number, artistRaw = artist) => ({ artist, artistRaw, title: "T", playedAt });
function fakeFetch(value: unknown, init: { ok?: boolean; status?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, req: RequestInit) => {
    calls.push({ url, init: req });
    return new Response(JSON.stringify({ status: init.status ?? "success", value }), { status: init.ok === false ? 500 : 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("Hard Rule 3: rhythmlab (and anything but 88nine and hyfin) throws before any fetch", async () => {
  const f = fakeFetch([]);
  for (const s of ["rhythmlab", "414music", "88Nine", ""]) await expect(lastPlayed(f.fn, s, "Alfa Mist")).rejects.toThrow(/station not allowed/);
  expect(f.calls).toHaveLength(0);
});

test("88nine: one POST of plays:searchByStation to the public query endpoint; the newest exact match's Chicago day", async () => {
  const f = fakeFetch([
    play("Alfa Mist", Date.UTC(2026, 9, 2, 3)), // Oct 1, 10 pm in Chicago
    play("Alfa Mist", Date.UTC(2026, 8, 20, 18)),
    play("Alfa Mistake", Date.UTC(2026, 9, 28, 18)),
  ]);
  expect(await lastPlayed(f.fn, "88nine", "Alfa Mist")).toBe("2026-10-01");
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toBe(PLAYS_URL);
  expect(PLAYS_URL).toBe("https://precise-fish-444.convex.cloud/api/query");
  expect(f.calls[0]!.init.method).toBe("POST");
  const body = JSON.parse(String(f.calls[0]!.init.body));
  expect(body.path).toBe("plays:searchByStation");
  expect(body.args).toMatchObject({ stationSlug: "88nine", q: "Alfa Mist" });
  expect(body.args.afterMs).toBe(NOW - 90 * 86_400_000);
  expect(body.args.beforeMs).toBe(NOW);
  expect(body.args.limit).toBeLessThanOrEqual(500);
  expect(JSON.stringify(body)).not.toMatch(/start/);
});

test("exact normalized match: accents and case fold; a credit in artistRaw counts; a longer name does not", async () => {
  expect(await lastPlayed(fakeFetch([play("ALFA MÏST", Date.UTC(2026, 9, 20, 18))]).fn, "hyfin", "Alfa Mist")).toBe("2026-10-20");
  expect(await lastPlayed(fakeFetch([play("Justine Skye", Date.UTC(2026, 9, 21, 18), "Justine Skye & KAYTRANADA")]).fn, "hyfin", "Kaytranada")).toBe("2026-10-21");
  expect(await lastPlayed(fakeFetch([play("Ama Ferrell", Date.UTC(2026, 9, 21, 18))]).fn, "hyfin", "Ama")).toBeNull();
  expect(await lastPlayed(fakeFetch([]).fn, "hyfin", "Ama")).toBeNull();
});

test("a failed or malformed answer throws (the caller leaves that artist out), never a guess", async () => {
  await expect(lastPlayed(fakeFetch([], { ok: false }).fn, "88nine", "A")).rejects.toThrow();
  await expect(lastPlayed(fakeFetch([], { status: "error" }).fn, "88nine", "A")).rejects.toThrow();
  await expect(lastPlayed(fakeFetch({ not: "a list" }).fn, "88nine", "A")).rejects.toThrow();
  // Rows without a usable artist or time are skipped, not trusted.
  expect(await lastPlayed(fakeFetch([{ artist: "A" }, { playedAt: 5 }, null]).fn, "88nine", "A")).toBeNull();
});

test("researchCard: the show, counts and a link only", () => {
  const card = researchCard({ jobId: "rj-abc123", showDate: "2026-10-30", changes: 2, open: 3, appUrl: "https://aircheck.example/" });
  expect(card).toBe("Pre-air verify · 10-30-26\n2 changes · 3 open\nOpen report: https://aircheck.example/research/rj-abc123");
  expect(researchCard({ jobId: "rj-x", showDate: "2026-10-02", changes: 1, open: 0, appUrl: "https://x" })).toBe(
    "Pre-air verify · 10-2-26\n1 change · 0 open\nOpen report: https://x/research/rj-x",
  );
});
