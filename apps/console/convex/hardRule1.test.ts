// @vitest-environment edge-runtime
import { expect, test } from "vitest";

// Hard Rule 1: the only public mutation (or action) is packages.decide. Convex marks
// registered functions with isPublic / isInternal / isMutation / isAction.
type Registered = { isPublic?: boolean; isInternal?: boolean; isMutation?: boolean; isAction?: boolean };

test("the only public write is packages.decide", async () => {
  const modules = import.meta.glob(["./*.ts", "!./*.test.ts"]);
  const exposed: string[] = [];
  const internal: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    const mod = (await load()) as Record<string, unknown>;
    for (const [name, fn] of Object.entries(mod)) {
      const f = fn as Registered;
      if (typeof fn !== "function" || !(f.isMutation || f.isAction)) continue;
      const id = `${path.slice(2, -3)}.${name}`;
      (f.isPublic ? exposed : internal).push(id);
    }
  }
  expect(exposed).toEqual(["packages.decide"]);
  expect(internal.sort()).toEqual(
    ["packages.attachAudio", "packages.claimForPublish", "packages.recordResult", "packages.submit", "seed.seedDemo"].sort(),
  );
});
