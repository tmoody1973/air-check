// Keyless Crate servers only (Tarik, Oct 26). Everything else, including telegraph_* and tumblr_*
// publishing (Hard Rule 7), is hidden from tools/list and refused on tools/call.
const ALLOWED_PREFIXES = ["musicbrainz_", "wikipedia_", "bandcamp_", "itunes_"] as const;

// Exact names refused even though their prefix is allowed. Hard Rule 13: the Bandcamp collection is
// read only by the ingest worker.
export const DENIED_CRATE_TOOLS: readonly string[] = ["bandcamp_get_fan_collection"];

export function isAllowedCrateTool(name: string): boolean {
  if (DENIED_CRATE_TOOLS.includes(name)) return false;
  return ALLOWED_PREFIXES.some((p) => name.startsWith(p) && name.length > p.length);
}

// Crate runs on the host, outside OpenShell's egress policy, so any URL it is handed must be Bandcamp.
function isBandcampUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const u = new URL(value);
  const host = u.hostname.toLowerCase();
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    u.port === "" && // URL drops an explicit :443, so only other ports show here
    (host === "bandcamp.com" || host.endsWith(".bandcamp.com"))
  );
}

const looksLikeUrl = (s: string) => s.includes("://") || /^https?:/i.test(s);

/** A refusal reason for a call's arguments, or null when they may go to Crate. Never echoes the URL. */
export function checkCrateArgs(_name: string, args: unknown): string | null {
  const refused = "Refused: Crate tools may only fetch https://*.bandcamp.com URLs.";
  const walk = (value: unknown, key: string | undefined): boolean => {
    if (key === "url" && value !== undefined && value !== null && typeof value !== "string") return false;
    if (typeof value === "string") return key === "url" || looksLikeUrl(value) ? isBandcampUrl(value) : true;
    if (Array.isArray(value)) return value.every((v) => walk(v, key));
    if (value !== null && typeof value === "object") return Object.entries(value).every(([k, v]) => walk(v, k));
    return true;
  };
  return walk(args, undefined) ? null : refused;
}
