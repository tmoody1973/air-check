// Keyless Crate servers only (Tarik, Oct 26). Everything else, including telegraph_* and tumblr_*
// publishing (Hard Rule 7), is hidden from tools/list and refused on tools/call.
const ALLOWED_PREFIXES = ["musicbrainz_", "wikipedia_", "bandcamp_", "itunes_"] as const;

export function isAllowedCrateTool(name: string): boolean {
  return ALLOWED_PREFIXES.some((p) => name.startsWith(p) && name.length > p.length);
}
