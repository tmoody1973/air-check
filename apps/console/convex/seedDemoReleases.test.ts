// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

vi.mock("./demoReleases", () => ({
  DEMO_RELEASES: [
    { artist: "Versa", title: "Reset", label: "Deep Heads", type: "album", bandcampPage: "https://deepheads.bandcamp.com/album/reset", embed: { kind: "album", id: "3847473100" }, art: "https://f4.bcbits.com/img/a1792156796_5.jpg" },
    { artist: "Bad", title: "Link", bandcampPage: "https://evil.example/album/x", embed: { kind: "album", id: "1" } },
    { artist: "Bad", title: "Art", bandcampPage: "https://x.bandcamp.com/album/art", embed: { kind: "album", id: "2" }, art: "https://evil.example/a.jpg" },
  ],
}));

const modules = import.meta.glob("./**/*.*s");

describe("seedDemo: real released samples (decision 026)", () => {
  test("a valid one gets its player, cover and page in the demo; a bad page is left out; a bad cover is dropped", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const rows = await t.run((ctx) => ctx.db.query("releases").collect());
    expect(rows.every((r) => r.workspace === "demo")).toBe(true);
    const versa = rows.find((r) => r.title === "Reset")!;
    expect(versa).toMatchObject({ embed: { kind: "album", id: "3847473100" }, embedState: "ready", art: "https://f4.bcbits.com/img/a1792156796_5.jpg", bandcampPage: "https://deepheads.bandcamp.com/album/reset", source: "bandcamp" });
    expect(versa).not.toHaveProperty("senders");
    expect(rows.find((r) => r.title === "Link")).toBeUndefined();
    expect(rows.find((r) => r.title === "Art")).not.toHaveProperty("art");
  });
});
