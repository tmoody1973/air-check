// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import http from "./http";

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
    ["chat.send", "packages.decide", "relay.activity", "relay.events", "relay.finished", "relay.started", "relay.status", "runs.requestStop", "tracklist.draft"].sort(),
  );
  expect(internal.sort()).toEqual(
    ["packages.attachAudio", "packages.claimForPublish", "packages.recordResult", "packages.submit", "scripted.step", "seed.seedDemo"].sort(),
  );
});

// The chat/run/relay code sits next to the publish path, so it must not touch it: no publish or decide
// function by name, no calls into packages.ts, and the packages table is only ever read (relay.events reads it
// for the run's packageId). This is a source-text check: it cannot see a call built from a computed string.
const RUN_FILES = ["relay", "chat", "tracklist", "scripted", "scriptedEvents", "demoLimits", "sandbox", "enqueue", "applyEvents", "runs"];
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
