export interface SourceFile {
  path: string;
  content: string;
}

// These files name the forbidden strings in order to check for them.
const EXEMPT_PREFIXES = ["docs/", "skills/", "fixtures/", "packages/core/test/"];
const EXEMPT_FILES = new Set(["packages/core/src/boundaries.ts", "tests/boundaries.test.ts"]);
const UPLOAD_URL = "api.mixcloud.com/upload";
const UPLOAD_ALLOWED = ["services/publisher/"];
const IMPORTS_SERVICES = /(?:from\s+|require\(\s*|import\(\s*)["'](?:[^"']*\bservices\/|@aircheck\/(?!core["'\/]))/;
// The agent may use the pure rules in @aircheck/core, but never the gate's decide or publish steps.
const GATE_ACCESS = /\bApprovalGate\b|\.decide\(|\bclaimForPublish\b|\brecordResult\b/;
const SOURCE_CREDENTIAL = /\b(?:MIXCLOUD|BOX|GOOGLE|DROPBOX|SUBSONIC)_[A-Z0-9_]+/;
const START_TIME = "start_time";

const exempt = (path: string) =>
  path.endsWith(".md") || EXEMPT_FILES.has(path) || EXEMPT_PREFIXES.some((p) => path.startsWith(p));

/**
 * Structural checks for Hard Rules 1, 2 and 11:
 * only the publisher talks to the Mixcloud upload API, the agent holds no source or Mixcloud
 * credentials and imports nothing from the services, and no code carries track start times.
 * This is a tripwire, not proof: string tricks can evade it. Hard Rule 2's real enforcement is the agent container's environment.
 */
export function findBoundaryViolations(files: SourceFile[]): string[] {
  return files.flatMap(({ path, content }) => {
    if (exempt(path)) return [];
    const found: string[] = [];
    if (content.includes(UPLOAD_URL) && !UPLOAD_ALLOWED.some((p) => path.startsWith(p)))
      found.push(`${path}: Mixcloud upload URL outside services/publisher (Hard Rule 1)`);
    if (path.startsWith("agent/") && IMPORTS_SERVICES.test(content))
      found.push(`${path}: agent code imports from services/ (Hard Rule 1)`);
    if (path.startsWith("agent/") && GATE_ACCESS.test(content))
      found.push(`${path}: agent code reaches the approval gate or publish steps (Hard Rule 1)`);
    if (path.startsWith("agent/") && SOURCE_CREDENTIAL.test(content))
      found.push(`${path}: agent code references a source or Mixcloud credential (Hard Rule 2)`);
    if (content.includes(START_TIME)) found.push(`${path}: contains ${START_TIME} (Hard Rule 11)`);
    return found;
  });
}
