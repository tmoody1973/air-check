export interface SourceFile {
  path: string;
  content: string;
}

// These files name the forbidden strings in order to check for them.
const EXEMPT_PREFIXES = ["docs/", "skills/", "fixtures/", "packages/core/test/"];
const EXEMPT_FILES = new Set(["packages/core/src/boundaries.ts", "tests/boundaries.test.ts"]);
const UPLOAD_URL = "api.mixcloud.com/upload";
const UPLOAD_ALLOWED = ["apps/publisher/src/"];
const IMPORTS_SERVICES = /(?:from\s+|require\(\s*|import\(\s*)["'](?:[^"']*\bservices\/|@aircheck\/(?!core["'\/]))/;
// The agent may use the pure rules in @aircheck/core, but never the gate's decide or publish steps.
const GATE_ACCESS = /\bApprovalGate\b|\.decide\(|\bclaimForPublish\b|\brecordResult\b|\bunclaim\b/;
const SOURCE_CREDENTIAL = /\b(?:MIXCLOUD|BOX|GOOGLE|DROPBOX|SUBSONIC)_[A-Z0-9_]+/;
const START_TIME = "start_time";
// Hard Rule 2: only the ingest service (and the console's Connect Google / Connect Dropbox routes, which mint the refresh
// token) talk to Box, Google Drive or Dropbox. fonts.googleapis.com is not matched.
const SOURCE_HOST = /\b(?:api\.box\.com|[a-z0-9-]+\.boxcloud\.com|oauth2\.googleapis\.com|www\.googleapis\.com|accounts\.google\.com|(?:api|content)\.dropboxapi\.com|www\.dropbox\.com)\b/;
const SOURCE_HOST_ALLOWED = [
  "apps/ingest/src/",
  "apps/ingest/test/", // the download-host allow-list is tested by name; tests only ever reach 127.0.0.1
  "apps/console/src/lib/oauth.ts",
  "apps/console/src/lib/ingestOAuth.ts",
  "apps/console/src/lib/ingestOAuth.test.ts",
  "apps/console/src/app/api/google/",
  "apps/console/src/app/api/dropbox/",
  "apps/console/src/app/api/ingestSources.routes.test.ts",
];

// Plan 8: the console receives email and fetches nothing. One file names AgentMail's host; only the ingest worker's
// extractor names Token Factory; only its Bandcamp page reader fetches next to bandcamp.com; nothing reads an
// attachment or sends mail.
const AGENTMAIL_HOST = "api.agentmail.to";
const AGENTMAIL_ALLOWED = "apps/console/src/lib/agentmail.ts";
const TOKEN_FACTORY_HOST = "tokenfactory.nebius.com";
const TOKEN_FACTORY_ALLOWED = "apps/ingest/src/tokenFactory.ts";
const BANDCAMP_FETCH_ALLOWED = "apps/ingest/src/bandcamp.ts";
const MAIL_ONLY_READS = ["/attachments", "messages/send"];
const isTest = (path: string) => /(?:^|\/)test\/|\.test\.[cm]?[jt]sx?$/.test(path);

const exempt = (path: string) =>
  path.endsWith(".md") || EXEMPT_FILES.has(path) || EXEMPT_PREFIXES.some((p) => path.startsWith(p));

/**
 * Structural checks for Hard Rules 1, 2, 5 and 11 (Plan 8 adds the email rules in plan8Violations):
 * only the publisher talks to the Mixcloud upload API, only the ingest service and the Connect routes name the Box,
 * Google or Dropbox API hosts, the agent holds no source or Mixcloud
 * credentials and imports nothing from the services, and no code carries track start times.
 * This is a tripwire, not proof: string tricks can evade it. Hard Rule 2's real enforcement is the agent container's environment.
 */
export function findBoundaryViolations(files: SourceFile[]): string[] {
  return files.flatMap(({ path, content }) => {
    if (exempt(path)) return [];
    const found: string[] = [];
    if (content.includes(UPLOAD_URL) && !UPLOAD_ALLOWED.some((p) => path.startsWith(p)))
      found.push(`${path}: Mixcloud upload URL outside apps/publisher/src (Hard Rule 1)`);
    if (path.startsWith("agent/") && IMPORTS_SERVICES.test(content))
      found.push(`${path}: agent code imports from services/ (Hard Rule 1)`);
    if (path.startsWith("agent/") && GATE_ACCESS.test(content))
      found.push(`${path}: agent code reaches the approval gate or publish steps (Hard Rule 1)`);
    if (path.startsWith("agent/") && SOURCE_CREDENTIAL.test(content))
      found.push(`${path}: agent code references a source or Mixcloud credential (Hard Rule 2)`);
    if (SOURCE_HOST.test(content) && !SOURCE_HOST_ALLOWED.some((p) => p.endsWith("/") ? path.startsWith(p) : path === p))
      found.push(`${path}: Box, Google or Dropbox API host outside apps/ingest/src and the Connect routes (Hard Rule 2)`);
    if (content.includes(START_TIME)) found.push(`${path}: contains ${START_TIME} (Hard Rule 11)`);
    if (!isTest(path)) found.push(...plan8Violations(path, content));
    return found;
  });
}

function plan8Violations(path: string, content: string): string[] {
  const found: string[] = [];
  if (content.includes(AGENTMAIL_HOST) && path !== AGENTMAIL_ALLOWED)
    found.push(`${path}: AgentMail API host outside ${AGENTMAIL_ALLOWED} (Plan 8)`);
  // ponytail: apps/ only; spikes/ prototypes and the agent's own model provider config are not the console or a service.
  if (path.startsWith("apps/") && content.includes(TOKEN_FACTORY_HOST) && path !== TOKEN_FACTORY_ALLOWED)
    found.push(`${path}: Token Factory host outside ${TOKEN_FACTORY_ALLOWED} (Plan 8)`);
  // In the ingest worker, call( is the shared fetch helper (http.ts), so it counts as a fetch there.
  const fetches = content.includes("fetch(") || (path.startsWith("apps/ingest/") && content.includes("call("));
  if (content.includes("bandcamp.com") && fetches && path !== BANDCAMP_FETCH_ALLOWED)
    found.push(`${path}: fetches next to bandcamp.com outside ${BANDCAMP_FETCH_ALLOWED} (Plan 8)`);
  if (path.startsWith("apps/") && MAIL_ONLY_READS.some((s) => content.includes(s)))
    found.push(`${path}: AgentMail attachments or send call in apps/ (Plan 8)`);
  return found;
}
