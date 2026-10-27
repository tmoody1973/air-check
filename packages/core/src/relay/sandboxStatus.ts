/**
 * Reads `nemohermes <name> status` and `... policy get` text. Phase comes from the status text's `Phase:` line;
 * the allowed-host count is the distinct `- host: <value>` entries in the POLICY text only (status text has
 * `- host:` lines of its own that are not policy).
 */
export function parseSandboxStatus(statusText: string, policyText: string): { phase: string | null; allowedHosts: number } {
  const phase = /^\s*Phase:[ \t]*(.*)$/m.exec(statusText)?.[1]?.trim() || null;
  const hosts = new Set([...policyText.matchAll(/^\s*-\s*host:[ \t]*(\S+)/gm)].map((m) => m[1]!));
  return { phase, allowedHosts: hosts.size };
}
