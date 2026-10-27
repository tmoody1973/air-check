// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import http from "./http";

// Hard Rule 1: the only public mutation (or action) is packages.decide. HTTP actions are public
// by nature, so any httpAction export counts as an exposed write (the one allowed is the agent route, pinned below). Convex marks
// registered functions with isPublic / isInternal / isMutation / isAction.
type Registered = { isPublic?: boolean; isInternal?: boolean; isMutation?: boolean; isAction?: boolean; isHttp?: boolean };

test("the only public write is packages.decide", async () => {
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
  expect(exposed).toEqual(["packages.decide"]);
  expect(internal.sort()).toEqual(
    ["packages.attachAudio", "packages.claimForPublish", "packages.recordResult", "packages.submit", "seed.seedDemo"].sort(),
  );
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
