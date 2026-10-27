// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import http from "./http";

// Hard Rule 1: the only public mutation (or action) is packages.decide. HTTP actions are public
// by nature, so any httpAction export counts as an exposed write (none are allowed today). Convex marks
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
