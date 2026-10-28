// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import http from "./http";
import schema from "./schema";

// Hard Rule 1: no model output reaches publish. Every public write is listed here by name; HTTP actions
// are public by nature, so any httpAction export counts too (the one allowed is the agent route, pinned below).
// Convex marks registered functions with isPublic / isInternal / isMutation / isAction.
type Registered = { isPublic?: boolean; isInternal?: boolean; isMutation?: boolean; isAction?: boolean; isHttp?: boolean };

test("the public writes are exactly the allowlist", async () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./_generated/**"]);
  const exposed: string[] = [];
  const internal: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    const mod = (await load()) as Record<string, unknown>;
    for (const [name, fn] of Object.entries(mod)) {
      const f = fn as Registered;
      if (typeof fn !== "function" || !(f.isMutation || f.isAction || f.isHttp)) continue;
      const id = `${path.slice(2, -3)}.${name}`;
      (f.isPublic || f.isHttp ? exposed : internal).push(id);
    }
  }
  expect(exposed.sort()).toEqual(
    [
      "chat.send", "packages.decide", "relay.activity", "relay.events", "relay.finished", "relay.started", "relay.status", "runs.requestStop", "tracklist.draft",
      // Plan 5: the cover (signed-in human), the media and publisher services (each with its own token), Mixcloud status.
      "packages.setCover", "packages.coverUploadUrl",
      "media.attached", "media.waiting",
      "publisher.claim", "publisher.result", "publisher.reconcile", "publisher.setMixcloud",
      "mixcloud.connected",
    ].sort(),
  );
  expect(internal.sort()).toEqual(
    ["packages.attachAudio", "packages.claimForPublish", "packages.recordResult", "packages.submit", "scripted.step", "seed.seedDemo"].sort(),
  );
});

// The chat/run/relay code sits next to the publish path, so it must not touch it: no publish or decide
// function by name, no calls into packages.ts, and the packages table is only ever read (relay.events reads it
// for the run's packageId). This is a source-text check: it cannot see a call built from a computed string.
const RUN_FILES = ["relay", "chat", "tracklist", "scripted", "scriptedEvents", "demoLimits", "sandbox", "enqueue", "applyEvents", "runs", "runDefaults"];
const src = (name: string) => readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");

test("run, chat and relay code never reach packages.decide or the publish functions", () => {
  for (const name of RUN_FILES) {
    const text = src(name);
    for (const banned of ["packages.decide", "claimForPublish", "recordResult", "attachAudio", "internal.packages", "api.packages", "gateFor", "convexPackageStore", "ApprovalGate"]) {
      expect(text, `${name}.ts mentions ${banned}`).not.toContain(banned);
    }
    expect(text, `${name}.ts imports packages`).not.toMatch(/from "\.\/packages/);
  }
});

test("run, chat and relay code import only actorOf, workspaceOf and Workspace from gate", () => {
  for (const name of RUN_FILES) {
    const names = [...src(name).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"\.\/gate"/g)]
      .flatMap((m) => m[1]!.split(",").map((x) => x.trim().replace(/^type\s+/, "")).filter(Boolean));
    expect(names.filter((n) => !["actorOf", "workspaceOf", "Workspace"].includes(n)), `${name}.ts gate imports`).toEqual([]);
    expect(src(name), `${name}.ts has a non-braced gate import`).not.toMatch(/from\s+"\.\/gate"[\s\S]*?^import\s+\*/m);
  }
});

test("run, chat and relay code never write the packages table", () => {
  for (const name of RUN_FILES) {
    const text = src(name);
    for (const m of text.matchAll(/"packages"/g)) {
      expect(text.slice(Math.max(0, m.index! - 15), m.index! + 10), `${name}.ts uses "packages" outside ctx.db.query`).toMatch(/ctx\.db\.query\("packages"/);
    }
    expect(text).not.toMatch(/(?:patch|insert|replace|delete)\("packages"/);
  }
});

test("the only HTTP route is POST /agent/packages", () => {
  expect(http.getRoutes().map(([path, method]) => [path, method])).toEqual([["/agent/packages", "POST"]]);
});

test("the agent route reaches only internal.packages.submit", () => {
  for (const file of ["./http.ts", "./agentSubmit.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const refs = new Set(src.match(/\b(?:internal|api)\.\w+\.\w+/g) ?? []);
    expect([...refs].filter((r) => r !== "internal.packages.submit")).toEqual([]);
  }
  expect(readFileSync(new URL("./http.ts", import.meta.url), "utf8")).toContain("internal.packages.submit");
});

test("the agent route files import only what they should and make one ctx.run call", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const httpSrc = read("./http.ts");
  const rel = [...httpSrc.matchAll(/from "(\.[^"]*)"/g)].map((m) => m[1]).sort();
  expect(rel).toEqual(["./_generated/api", "./_generated/server", "./agentSubmit"]);
  const agent = read("./agentSubmit.ts");
  expect(agent).not.toMatch(/_generated/);
  expect(agent).not.toMatch(/\bctx\b/);
  expect(httpSrc.match(/ctx\.run\w*/g)).toEqual(["ctx.runMutation"]);
});

// Plan 5: the media and publisher services. Neither can decide; the publisher reaches packages only through the
// gate's claimForPublish and recordResult (and reads them); Mixcloud status code never touches packages.
const SERVICE_FILES = ["media", "publisher", "mixcloud"];

test("media, publisher and mixcloud code never call decide", () => {
  for (const name of SERVICE_FILES) {
    const text = src(name);
    expect(text, `${name}.ts mentions decide`).not.toMatch(/\bdecide\b/);
    for (const banned of ["internal.packages", "api.packages", "ApprovalGate"]) expect(text, `${name}.ts mentions ${banned}`).not.toContain(banned);
  }
});

test("the publisher reaches packages only through claimForPublish and recordResult", () => {
  const text = src("publisher");
  expect([...new Set([...text.matchAll(/gateFor\(ctx\)\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(["claimForPublish", "recordResult"]);
  expect(text.match(/gateFor\(/g)).toHaveLength(text.match(/gateFor\(ctx\)\.(?:claimForPublish|recordResult)\(/g)!.length);
  for (const banned of ["convexPackageStore", "compareAndSwap", "attachAudio", "setCover"]) expect(text, `publisher.ts mentions ${banned}`).not.toContain(banned);
  // No direct writes at all: Mixcloud status goes through mixcloud.ts's writer.
  expect(text).not.toMatch(/\.(?:patch|insert|replace|delete)\(/);
});

test("media and mixcloud code never claim or record a publish result", () => {
  for (const name of ["media", "mixcloud"]) {
    for (const banned of ["claimForPublish", "recordResult"]) expect(src(name), `${name}.ts mentions ${banned}`).not.toContain(banned);
  }
  expect(src("mixcloud")).not.toMatch(/"packages"|gateFor|convexPackageStore/);
});

afterEach(() => vi.unstubAllEnvs());
const modules = import.meta.glob("./**/*.*s");

test("a package never approved through packages.decide cannot be claimed", async () => {
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
  await t.mutation(internal.packages.submit, { draft });
  const args = { packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 1, mp3Bytes: 1 };
  await t.mutation(api.media.attached, { token: "m".repeat(48), ...args });
  await expect(t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: draft.id })).rejects.toThrow(/NOT_READY/);
  const doc = await t.run((ctx) => ctx.db.query("packages").first());
  expect(doc?.status).toBe("awaiting_review");
});

test("the relay's and the agent's tokens are refused by every media and publisher function", async () => {
  const RELAY = "r".repeat(48);
  const AGENT = "a".repeat(48);
  vi.stubEnv("RELAY_TOKEN", RELAY);
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", "d".repeat(48));
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
  await t.mutation(internal.packages.submit, { draft });
  const cover = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const before = await t.run((ctx) => ctx.db.query("packages").collect());
  for (const token of [RELAY, AGENT, "d".repeat(48)]) {
    const id = draft.id;
    const calls = [
      t.query(api.media.pending, { token }),
      t.mutation(api.media.attached, { token, packageId: id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 1, mp3Bytes: 1 }),
      t.mutation(api.media.waiting, { token, items: [] }),
      t.query(api.media.cleanup, { token }),
      t.query(api.publisher.queue, { token }),
      t.mutation(api.publisher.claim, { token, packageId: id }),
      t.mutation(api.publisher.result, { token, packageId: id, result: { status: "outcome_unknown" } }),
      t.mutation(api.publisher.reconcile, { token }),
      t.query(api.publisher.coverUrl, { token, storageId: cover }),
      t.mutation(api.publisher.setMixcloud, { token, state: "connected" }),
    ];
    for (const call of calls) await expect(call).rejects.toThrow(/UNAUTHORIZED/);
  }
  expect(await t.run((ctx) => ctx.db.query("packages").collect())).toEqual(before);
});
