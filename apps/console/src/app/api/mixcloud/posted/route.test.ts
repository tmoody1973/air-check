import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postedShows } from "@/lib/mixcloudOAuth";

// GET /api/mixcloud/posted?year=2025: which 2025 Fridays already have a show on Tarik's Mixcloud, read from the public
// API (no credentials). The session is faked; fetch is mocked so nothing leaves the machine.
const session = vi.hoisted(() => ({ current: null as null | { userId: string; sessionClaims: Record<string, unknown> } }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: session.current?.userId ?? null, sessionClaims: session.current?.sessionClaims ?? null, getToken: async () => "jwt" }),
}));

const STAFF = { userId: "u1", sessionClaims: { aud: "convex", email: "dj@radiomilwaukee.org", email_verified: true } };
const DEMO = { userId: "d1", sessionClaims: { aud: "convex", role: "demo", email: "demo@example.com", email_verified: true } };
const OUTSIDER = { userId: "x1", sessionClaims: { aud: "convex", email: "someone@gmail.com", email_verified: true } };
const FIRST = "https://api.mixcloud.com/rhythmlab/cloudcasts/?limit=100";
const page = (names: string[], next?: string, created = "2026-01-01T00:00:00Z") =>
  new Response(JSON.stringify({ data: names.map((name) => ({ name, created_time: created })), paging: next ? { next } : {} }), { status: 200 });

const logs: string[] = [];
beforeEach(() => {
  session.current = STAFF;
  logs.length = 0;
  for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const get = async (query = "?year=2025") => {
  const { GET } = await import("./route");
  return GET(new Request(`http://internal:3000/api/mixcloud/posted${query}`));
};

describe("postedShows (the public read)", () => {
  it("reads the real name shapes into dates, keeps only that year, and follows paging", async () => {
    const fetch = vi.fn(async (url: string) =>
      url === FIRST
        ? page(["Rhythm Lab Radio 1.3.25", "RLR 7.18.25 | Moses Sumney, Little Simz", "RL10.24.25 | Kokoroko"], "https://api.mixcloud.com/rhythmlab/cloudcasts/?limit=100&offset=100")
        : page(["Rhythm Lab Radio 9-5-25", "Rhythm Lab Radio 1-2-26", "An interview with no date"]),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await postedShows("2025")).toEqual([
      { date: "2025-01-03", name: "Rhythm Lab Radio 1.3.25" },
      { date: "2025-07-18", name: "RLR 7.18.25 | Moses Sumney, Little Simz" },
      { date: "2025-09-05", name: "Rhythm Lab Radio 9-5-25" },
      { date: "2025-10-24", name: "RL10.24.25 | Kokoroko" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![0]).toBe(FIRST);
  });

  it("stops at 10 pages, never follows a next link off api.mixcloud.com, and stops once uploads are older than the year", async () => {
    const loop = vi.fn(async () => page(["Rhythm Lab Radio 1.3.25"], FIRST));
    vi.stubGlobal("fetch", loop);
    expect(await postedShows("2025")).toHaveLength(10);
    expect(loop).toHaveBeenCalledTimes(10);

    const evil = vi.fn(async () => page([], "https://evil.example/steal"));
    vi.stubGlobal("fetch", evil);
    expect(await postedShows("2025")).toEqual([]);
    expect(evil).toHaveBeenCalledTimes(1);

    const old = vi.fn(async () => page(["Rhythm Lab Radio 12.27.24"], FIRST, "2024-12-28T00:00:00Z"));
    vi.stubGlobal("fetch", old);
    expect(await postedShows("2025")).toEqual([]);
    expect(old).toHaveBeenCalledTimes(1);
  });

  it("is null on a network error, a non-2xx or a body that isn't the list", async () => {
    for (const f of [async () => Promise.reject(new Error("down")), async () => new Response("no", { status: 503 }), async () => new Response("{}", { status: 200 })]) {
      vi.stubGlobal("fetch", vi.fn(f));
      expect(await postedShows("2025")).toBeNull();
    }
  });
});

describe("GET /api/mixcloud/posted", () => {
  it("demo, outsider and signed-out get 403 and nothing is fetched", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const who of [DEMO, OUTSIDER, null]) {
      session.current = who;
      expect((await get()).status).toBe(403);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a bad year is 400", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const q of ["", "?year=25", "?year=abcd", "?year=2025x"]) expect((await get(q)).status).toBe(400);
  });

  it("returns { date, name }[], not cached, and logs a count only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page(["RLR 7.18.25 | Moses Sumney"])));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual([{ date: "2025-07-18", name: "RLR 7.18.25 | Moses Sumney" }]);
    expect(logs).toEqual(["mixcloud step=posted ok=true count=1"]);
  });

  it("an unreachable Mixcloud is 502 with a fixed reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(logs).toEqual(["mixcloud step=posted ok=false"]);
  });
});
