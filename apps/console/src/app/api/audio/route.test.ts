import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The signed-in session is faked; the file system is real (a temp AUDIO_DIR).
const session = vi.hoisted(() => ({ current: null as null | { userId: string; sessionClaims: Record<string, unknown> } }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: session.current?.userId ?? null, sessionClaims: session.current?.sessionClaims ?? null, getToken: async () => "jwt" }),
}));

const STAFF = { userId: "u1", sessionClaims: { aud: "convex", email: "dj@radiomilwaukee.org", email_verified: true } };
const DEMO = { userId: "d1", sessionClaims: { aud: "convex", role: "demo", email: "demo@example.com", email_verified: true } };
const OUTSIDER = { userId: "x1", sessionClaims: { aud: "convex", email: "someone@gmail.com", email_verified: true } };

const BYTES = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "audio-route-"));
  await writeFile(join(dir, "pkg-10-2-26.mp3"), BYTES);
  vi.stubEnv("AUDIO_DIR", dir);
  session.current = STAFF;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function get(packageId: string, headers: Record<string, string> = {}) {
  const { GET } = await import("./[packageId]/route");
  return GET(new Request(`http://internal:3000/api/audio/${encodeURIComponent(packageId)}`, { headers }), {
    params: Promise.resolve({ packageId }),
  });
}
const body = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe("GET /api/audio/[packageId]", () => {
  it("serves only GET", async () => {
    expect(Object.keys(await import("./[packageId]/route"))).toEqual(["GET"]);
  });

  it("staff get the whole MP3 with private, no-store headers", async () => {
    const res = await get("pkg-10-2-26");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("100");
    expect(await body(res)).toEqual(BYTES);
  });

  it("a range → 206 with Content-Range and only those bytes", async () => {
    const res = await get("pkg-10-2-26", { range: "bytes=10-19" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await body(res)).toEqual(BYTES.subarray(10, 20));
    const tail = await get("pkg-10-2-26", { range: "bytes=-5" });
    expect(tail.headers.get("content-range")).toBe("bytes 95-99/100");
    expect(await body(tail)).toEqual(BYTES.subarray(95));
  });

  it("an unsatisfiable range → 416 with the size", async () => {
    const res = await get("pkg-10-2-26", { range: "bytes=100-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */100");
  });

  it.each([["demo", DEMO], ["an outside account", OUTSIDER], ["signed out", null]])("%s → 403 and no audio", async (_l, who) => {
    session.current = who;
    const res = await get("pkg-10-2-26");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toBe("audio/mpeg");
  });

  it.each(["../pkg-10-2-26", "..%2Fsecret", "pkg-10-2-26/../../etc/passwd", "pkg-10-2-2026", "pkg-10-2-26.mp3", "PKG-10-2-26", "pkg-100-2-26", ""])(
    "a bad id (%s) → 400 before any path is built",
    async (id) => {
      const res = await get(id);
      expect(res.status).toBe(400);
    },
  );

  it("a missing file → 404 with a plain message", async () => {
    const res = await get("pkg-10-9-26");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("No prepared audio for this show.");
  });
});
