import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { guardArgs, USAGE } from "../src/cli.js";

/** An exit that really stops the caller, like process.exit. */
const io = () => {
  const err = vi.fn<(line: string) => void>();
  const exit = vi.fn<(code: number) => never>(() => { throw new Error("exited"); });
  return { err, exit };
};

describe("I1: arguments are exactly none, or --unlisted-test <packageId>", () => {
  test("no arguments: the service", () => {
    const o = io();
    expect(guardArgs([], o)).toEqual({ kind: "service" });
    expect(o.exit).not.toHaveBeenCalled();
  });

  test("--unlisted-test <id>: the one-off unlisted upload", () => {
    const o = io();
    expect(guardArgs(["--unlisted-test", "pkg-10-2-26"], o)).toEqual({ kind: "unlisted", packageId: "pkg-10-2-26" });
    expect(o.exit).not.toHaveBeenCalled();
  });

  test.each([
    [["--unlisted-test=pkg-10-2-26"]],
    [["--unlisted"]],
    [["pkg-10-2-26"]],
    [["--unlisted-test"]],
    [["--unlisted-test", ""]],
    [["--unlisted-test", "--verbose"]],
    [["--unlisted-test", "pkg-10-2-26", "extra"]],
  ])("%j: usage on stderr, exit 2, nothing else", (args) => {
    const o = io();
    expect(() => guardArgs(args, o)).toThrow("exited");
    expect(o.err).toHaveBeenCalledExactlyOnceWith(USAGE);
    expect(o.exit).toHaveBeenCalledExactlyOnceWith(2);
  });

  test("main checks the arguments before it reads config, connects to Convex or starts anything", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const guard = main.indexOf("guardArgs(process.argv.slice(2)");
    expect(guard).toBeGreaterThan(0);
    for (const later of ["loadConfig(", "connectConvex(", "openState(", "startup(", "every(config.pollMs", "unlistedTest("])
      expect(main.indexOf(later), later).toBeGreaterThan(guard);
    expect(main.match(/process\.argv/g)).toHaveLength(1); // argv is read in that one place only
  });
});
