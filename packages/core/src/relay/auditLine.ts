export interface AuditEvent {
  /** Dedupe key: decision|host:port|time bucket (minute if blocked, hour if allowed). */
  key: string;
  /** Line timestamp, ms since epoch. */
  at: number;
  decision: "allowed" | "blocked";
  host: string;
  port: number;
  binary?: string;
  reason?: string;
}

// [1793105781.120] ... NET:OPEN [MED] DENIED /usr/bin/python3.13(226) -> host:443 [policy:- engine:opa] [reason:...]
const NET = /^\[(\d+(?:\.\d+)?)\].*?NET:OPEN \[[^\]]*\] (DENIED|ALLOWED) (\S+?)\(\d+\) -> (\S+):(\d+)(?: .*?\[reason:([^\]]*)\])?/;

export function parseAuditLine(line: string): AuditEvent | null {
  const m = NET.exec(line);
  if (!m) return null;
  const ts = Number(m[1]);
  const decision = m[2] === "DENIED" ? "blocked" : "allowed";
  const host = m[4]!;
  const port = Number(m[5]);
  const bucket = Math.floor(ts / (decision === "blocked" ? 60 : 3600));
  return {
    key: `${decision}|${host}:${port}|${bucket}`,
    at: Math.round(ts * 1000),
    decision,
    host,
    port,
    binary: m[3]!,
    ...(m[6] !== undefined && { reason: m[6] }),
  };
}
