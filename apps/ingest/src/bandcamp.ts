// Hard Rule 5's one exception (ARCHITECTURE 3.7): the ingest worker reads one public Bandcamp album or track page per
// release, in code, for its player id. Nothing else fetches a link from an email. No audio, no cookie, no credential.
import { bandcampPageUrl, readBandcampEmbed, type BandcampEmbed } from "@aircheck/core";
import type { RadarConvex } from "./convex.js";
import { call, HttpError, readText, type Http } from "./http.js";

export type EmbedFailure =
  | "not_allowed"
  | "redirect_off_host"
  | "too_many_redirects"
  | "not_html"
  | "too_large"
  | "no_player"
  | "timeout"
  | "network"
  | `http_${number}`;

const PAGE_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 2 * 1024 ** 2;
const MAX_REDIRECTS = 2;
const EMBED_BATCH = 3;
const EMBED_GAP_MS = 2_000;
const USER_AGENT = "AirCheck/1.0 (Radio Milwaukee release radar)";

const isTimeout = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: unknown } | null)?.name as string);
const resolve = (location: string, base: string) => {
  try {
    return new URL(location, base).href;
  } catch {
    return "";
  }
};

/**
 * The page's HTML, or why it was not read. Only a URL that passes bandcampPageUrl is requested; a redirect is followed
 * only to another such page, at most twice. Plan 8 Task 6b reads its extra fields from this same fetch.
 */
async function fetchPage(http: Http, pageUrl: string): Promise<{ html: string } | { failed: EmbedFailure }> {
  // Defence in depth: Convex checked this page twice already.
  let url = bandcampPageUrl(pageUrl);
  if (!url) return { failed: "not_allowed" };
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await call(http, url, { redirect: "manual", credentials: "omit", headers: { accept: "text/html", "user-agent": USER_AGENT } }, PAGE_TIMEOUT_MS);
    } catch (e) {
      return { failed: isTimeout(e) ? "timeout" : "network" };
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location !== null) {
      await res.body?.cancel();
      const next = bandcampPageUrl(resolve(location, url));
      if (!next) return { failed: "redirect_off_host" };
      if (hop >= MAX_REDIRECTS) return { failed: "too_many_redirects" };
      url = next;
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) {
      await res.body?.cancel();
      return { failed: res.ok ? "not_html" : `http_${res.status}` };
    }
    try {
      return { html: await readText(res, MAX_PAGE_BYTES) };
    } catch (e) {
      return { failed: e instanceof HttpError ? "too_large" : isTimeout(e) ? "timeout" : "network" };
    }
  }
}

/** The album or track id from one queued page's own player URL. The HTML is dropped once the id is read. */
export async function bandcampEmbed(http: Http, pageUrl: string): Promise<BandcampEmbed | { failed: EmbedFailure }> {
  const page = await fetchPage(http, pageUrl);
  if ("failed" in page) return page;
  return readBandcampEmbed(page.html) ?? { failed: "no_player" };
}

/**
 * At most 3 queued pages a pass, one at a time. Each result goes to radar.embedResult (which writes the audit row with
 * the host). Hard Rule 8: the log carries the code only, never the URL.
 */
export async function embedPass(deps: { convex: RadarConvex; log: (line: string) => void; http: Http; sleep: (ms: number) => Promise<void> }): Promise<void> {
  const wanted = (await deps.convex.embedsWanted()).slice(0, EMBED_BATCH);
  for (const [i, { releaseId, pageUrl }] of wanted.entries()) {
    if (i > 0) await deps.sleep(EMBED_GAP_MS); // ponytail: courtesy pacing, not a rate limiter
    const t0 = Date.now();
    const result = await bandcampEmbed(deps.http, pageUrl);
    const failed = "failed" in result;
    try {
      await deps.convex.embedResult(releaseId, pageUrl, result);
      deps.log(`ingest step=bandcamp-embed ok=${!failed} code=${failed ? result.failed : result.kind} ms=${Date.now() - t0}`);
    } catch {
      deps.log(`ingest step=bandcamp-embed ok=false code=record_failed ms=${Date.now() - t0}`);
    }
  }
}
