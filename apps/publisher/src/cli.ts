export type Mode = { kind: "service" } | { kind: "unlisted"; packageId: string };

export const USAGE = "usage: aircheck-publisher [--unlisted-test <packageId>]";

/**
 * I1: the arguments are exactly none (the service) or `--unlisted-test <packageId>`. Anything else (a typo such as
 * `--unlisted-test=<id>`) would otherwise start the full service and publish publicly, so it prints the usage and
 * exits 2 before anything starts.
 */
export function guardArgs(args: string[], io: { err: (line: string) => void; exit: (code: number) => never }): Mode {
  if (args.length === 0) return { kind: "service" };
  const [flag, id] = args;
  if (args.length === 2 && flag === "--unlisted-test" && id && !id.startsWith("-")) return { kind: "unlisted", packageId: id };
  io.err(USAGE);
  return io.exit(2);
}
