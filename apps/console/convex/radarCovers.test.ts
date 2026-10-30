// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Decision 027: covers and links from a roundup email. The stored email keeps the allowed cover addresses (`images`)
// and links; the reader names numbers only; record maps each release's numbers to its own cover and links.
const modules = import.meta.glob("./**/*.*s");
const INBOX = "x".repeat(48);
const INGEST = "i".repeat(48);
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("INBOX_TOKEN", INBOX);
  vi.stubEnv("INGEST_TOKEN", INGEST);
});
afterEach(() => vi.unstubAllEnvs());

const H = "0a1b2c3d4e5f60718293a4b5c";
const C1 = `https://mcusercontent.com/${H}/images/11111111-aaaa-4bbb-8ccc-000000000001.jpg`;
const C2 = `https://gallery.mailchimp.com/${H}/images/22222222-aaaa-4bbb-8ccc-000000000002.png`;
const C3 = "https://f4.bcbits.com/img/a0000000003_10.jpg";
const L = ["https://co-sign.example.invalid/release/2001", "https://ferrolane.bandcamp.com/album/glass-weather", "https://co-sign.example.invalid/release/2002", "https://co-sign.example.invalid/release/2003"];
const PAGE_ART = "https://f4.bcbits.com/img/a0000000009_5.jpg";
const T0 = Date.UTC(2026, 9, 22, 15);

const mail = (over: Record<string, unknown> = {}) => ({
  tab: "cosign",
  sender: { name: "co-sign", address: "newmusic@co-sign.example.invalid" },
  subject: "Fwd: New music for radio, Oct 22",
  body: "[image 1] [link 1] Ferro Lane - Glass Weather [link 2]\n[image 2] Nova Reyes - Salt & Light [link 3]\n[image 3] Ama Trio - Way Out [link 4]",
  links: L,
  images: [C1, C2, C3],
  bandcampPages: [],
  hosts: ["co-sign.example.invalid"],
  ...over,
});
const received = (t: T, messageId: string, m: Record<string, unknown> = mail()) =>
  t.mutation(api.radar.received, { token: INBOX, messageId, receivedAt: T0, from: "tarik@radiomilwaukee.org", subject: String(m.subject), mail: m } as never);
const record = (t: T, messageId: string, release: Record<string, unknown>, more?: Record<string, unknown>[]) =>
  t.mutation(api.radar.record, { token: INGEST, messageId, outcome: { kind: "saved", release, ...(more && { more }) } } as never);
const byTitle = async (t: T) => Object.fromEntries((await t.run((ctx) => ctx.db.query("releases").collect())).map((r) => [r.title, r]));

describe("record: a roundup's covers and links (decision 027)", () => {
  test("each release takes its own cover and links; one with no image number gets no cover", async () => {
    const t = convexTest(schema, modules);
    await received(t, "m1");
    expect((await t.run((ctx) => ctx.db.query("inbox").first()))?.images).toEqual([C1, C2, C3]);
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", image: 1, links: [1, 2] }, [
      { artist: "Nova Reyes", title: "Salt & Light", image: 2, links: [3] },
      { artist: "Ama Trio", title: "Way Out", links: [4] },
    ]);
    const r = await byTitle(t);
    expect(r["Glass Weather"]).toMatchObject({ art: C1, links: [L[0], L[1]] });
    expect(r["Salt & Light"]).toMatchObject({ art: C2, links: [L[2]] });
    expect(r["Way Out"]).toMatchObject({ links: [L[3]] });
    expect(r["Way Out"]!.art).toBeUndefined();
    for (const x of Object.values(r)) {
      expect(x).not.toHaveProperty("image");
      expect(x.links!.every((l) => typeof l === "string")).toBe(true);
    }
  });

  test("numbers out of range give nothing; no link numbers keeps the old rule (every link the email held)", async () => {
    const t = convexTest(schema, modules);
    await received(t, "m1");
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", image: 9, links: [0, 99] }, [{ artist: "Nova Reyes", title: "Salt & Light" }]);
    const r = await byTitle(t);
    expect(r["Glass Weather"]!.art).toBeUndefined();
    expect(r["Glass Weather"]!.links).toEqual(L);
    expect(r["Salt & Light"]).toMatchObject({ links: L });
    expect(r["Salt & Light"]!.art).toBeUndefined();
  });

  test("a stored email whose images break the cover rule keeps none, so no release takes a cover from it", async () => {
    const t = convexTest(schema, modules);
    await received(t, "m1", mail({ images: [C1, "https://cdn.sponsor.example.invalid/ad.jpg"] }));
    expect((await t.run((ctx) => ctx.db.query("inbox").first()))?.images).toBeUndefined();
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", image: 1 });
    expect((await byTitle(t))["Glass Weather"]!.art).toBeUndefined();
  });

  test("an email with no images field still stores and saves (an older console)", async () => {
    const t = convexTest(schema, modules);
    const { images: _, ...old } = mail();
    await received(t, "m1", old);
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", image: 1, links: [2] });
    expect((await byTitle(t))["Glass Weather"]).toMatchObject({ links: [L[1]] });
    expect((await byTitle(t))["Glass Weather"]!.art).toBeUndefined();
  });

  test("more than 20 link numbers on one release is refused with a plain reason", async () => {
    const t = convexTest(schema, modules);
    await received(t, "m1");
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", links: Array.from({ length: 21 }, (_, i) => i + 1) });
    expect(await t.run((ctx) => ctx.db.query("inbox").first())).toMatchObject({ state: "refused" });
  });

  test("a later email fills an empty cover and adds its own links; a cover already set stays", async () => {
    const t = convexTest(schema, modules);
    await received(t, "m1", mail({ images: undefined }));
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", links: [1] });
    await received(t, "m2");
    await record(t, "m2", { artist: "Ferro Lane", title: "Glass Weather", image: 1, links: [2] });
    expect((await byTitle(t))["Glass Weather"]).toMatchObject({ art: C1, links: [L[0], L[1]] });
    await received(t, "m3");
    await record(t, "m3", { artist: "Ferro Lane", title: "Glass Weather", image: 2 });
    expect((await byTitle(t))["Glass Weather"]!.art).toBe(C1);
  });
});

describe("a Bandcamp page's cover wins over an email's", () => {
  const page = "https://ferrolane.bandcamp.com/album/glass-weather";
  async function queued(t: T) {
    await received(t, "m1", mail({ bandcampPages: [page] }));
    await record(t, "m1", { artist: "Ferro Lane", title: "Glass Weather", image: 1 });
    const rel = (await byTitle(t))["Glass Weather"]!;
    expect(rel).toMatchObject({ art: C1, embedState: "queued", bandcampPage: page });
    return rel._id as Id<"releases">;
  }
  test("the page's cover replaces the email's", async () => {
    const t = convexTest(schema, modules);
    const releaseId = await queued(t);
    await t.mutation(api.radar.embedResult, { token: INGEST, releaseId, pageUrl: page, result: { kind: "album", id: "1234567890", art: PAGE_ART } });
    expect((await byTitle(t))["Glass Weather"]!.art).toBe(PAGE_ART);
  });
  test("a page with no cover keeps the email's", async () => {
    const t = convexTest(schema, modules);
    const releaseId = await queued(t);
    await t.mutation(api.radar.embedResult, { token: INGEST, releaseId, pageUrl: page, result: { kind: "album", id: "1234567890" } });
    expect((await byTitle(t))["Glass Weather"]).toMatchObject({ art: C1, embedState: "ready" });
  });
});
