// Bare origin of the public site from NEXT_PUBLIC_APP_URL, so a trailing slash or path can't break origin checks.
// Undefined when unset or not a URL (dev, CI). Must read the env var literally: Next inlines it into the client bundle.
export function appOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}
