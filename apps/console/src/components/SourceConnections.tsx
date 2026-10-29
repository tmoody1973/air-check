import type { IngestErrorReason, Provider } from "../lib/ingestOAuth";
import { BTN, StatusMark } from "./MixcloudConnection";
import type { Workspace } from "./Shell";

// Where Air Check reads each show from: Box (audio), Google Drive (tracklists), Dropbox Paper (notes). Read-only.
// Google Drive and Dropbox connect from here like Mixcloud; Box is a server app with no button (Plan 6).

type SourceName = "box" | Provider;
export type SourceStatus = { source: SourceName; state: "connected" | "needs_reconnect" | "not_connected"; account?: string; lastError?: string };

/** M4: the ingest service can't read the saved token file (wrong owner); a Reconnect would not fix it. */
export const UNREADABLE = "unreadable_token_file";
export const UNREADABLE_TEXT = "Air Check can't read the saved sign-in — check the folder's owner (DEPLOY.md)";

export type SourceNoticeT =
  | { provider: Provider; kind: "connected" | "disconnected" }
  | { provider: Provider; kind: "error"; reason: IngestErrorReason | "unknown" }
  | null;

const NAME: Record<SourceName, string> = { google: "Google Drive", dropbox: "Dropbox", box: "Box" };
const READS: Record<SourceName, string> = {
  google: "Air Check reads the tracklist docs here.",
  dropbox: "Air Check reads the show notes in Dropbox Paper.",
  box: "Show audio comes from the Full Episodes folder. Box is set up on the server, in ingest.env, so there is nothing to connect here.",
};

const ERROR_TEXT = (name: string): Record<IngestErrorReason | "unknown", string> => ({
  state: "That sign-in link expired or was opened in another browser. Connect again from here.",
  denied: `${name} did not give access. Connect again if that was a mistake.`,
  exchange: `${name} did not accept the sign-in. Try connecting again.`,
  no_refresh: `${name} did not send a lasting key. Connect again and allow access on every screen.`,
  write: `The server could not save the ${name} key. Check the ingest token folder's owner and mode (docs/DEPLOY.md).`,
  status: "The connection status did not save. Try again.",
  config: `${name} is not set up on the server yet: the app settings are missing.`,
  unknown: `Something went wrong with ${name}. Try again.`,
});

/** The outcome the OAuth routes put in /settings?google=… or ?dropbox=…; an unknown reason never echoes the URL's text. */
export function sourceNoticeFrom(params: URLSearchParams): SourceNoticeT {
  for (const provider of ["google", "dropbox"] as const) {
    const v = params.get(provider);
    if (v === "connected" || v === "disconnected") return { provider, kind: v };
    if (v !== "error") continue;
    const reason = params.get("reason") ?? "";
    return { provider, kind: "error", reason: Object.hasOwn(ERROR_TEXT(""), reason) ? (reason as IngestErrorReason) : "unknown" };
  }
  return null;
}

export function SourceNotice({ notice }: { notice: NonNullable<SourceNoticeT> }) {
  const name = NAME[notice.provider];
  if (notice.kind === "error")
    return (
      <p role="alert" className="rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">
        {ERROR_TEXT(name)[notice.reason]}
      </p>
    );
  return (
    <p role="status" className="rounded-control bg-signal-soft px-4 py-3 text-sm text-signal-deep">
      {notice.kind === "connected" ? `${name} is connected. Air Check can read it, not change it.` : `${name} is disconnected. The key was deleted from the server.`}
    </p>
  );
}

function statusLine(s: SourceStatus): [mark: string, text: string, tone: string] {
  if (s.source === "box")
    return s.state === "connected"
      ? ["bg-signal", "Connected via server app", "text-ink"]
      : s.state === "needs_reconnect"
        ? ["bg-problem-text", "Sign-in failed: check the Box values in ingest.env", "text-problem-text"]
        : ["bg-line-strong", "Not configured", "text-ink"];
  if (s.lastError === UNREADABLE) return ["bg-problem-text", UNREADABLE_TEXT, "text-problem-text"];
  return s.state === "connected"
    ? ["bg-signal", `Connected as ${s.account ?? "[account]"}`, "text-ink"]
    : s.state === "needs_reconnect"
      ? ["bg-problem-text", `Reconnect needed: ${NAME[s.source]} stopped accepting the permission`, "text-problem-text"]
      : ["bg-line-strong", "Not connected", "text-ink"];
}

function SourceCard({ status }: { status: SourceStatus }) {
  const { source } = status;
  const [mark, text, tone] = statusLine(status);
  return (
    <section aria-labelledby={`${source}-heading`} className="rounded-card border border-line bg-surface p-5">
      <h3 id={`${source}-heading`} className="font-serif text-[24px] leading-tight font-normal">{NAME[source]}</h3>
      <div className="mt-3 flex flex-col gap-2">
        <StatusMark mark={mark} text={text} tone={tone} />
        <p className="text-[13px] leading-snug text-muted">
          {READS[source]}
          {source !== "box" && " Read-only: it can't change or delete anything. The key is kept in a locked file on the server that only the ingest service reads. The agent never holds it."}
        </p>
      </div>
      {source !== "box" && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {/* Same-origin POST forms, not links: a cross-site page can't start or end a connection. */}
          <form method="post" action={`/api/${source}/authorize`}>
            <button type="submit" className={`${BTN} border-signal bg-signal text-white hover:bg-signal-deep`}>
              {status.state === "not_connected" ? `Connect ${NAME[source]}` : "Reconnect"}
            </button>
          </form>
          {status.state !== "not_connected" && (
            <form method="post" action={`/api/${source}/disconnect`}>
              <button type="submit" className={`${BTN} border-line-strong bg-surface text-ink hover:bg-chip`}>
                Disconnect
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

export function SourceConnections({
  sources,
  workspace,
}: {
  /** undefined = loading; null = not allowed to see them (demo or not staff). A source with no row is not connected. */
  sources: SourceStatus[] | null | undefined;
  workspace: Workspace;
}) {
  return (
    <div className="mx-auto flex max-w-xl min-w-0 flex-col gap-4">
      <div>
        <h2 className="font-serif text-[28px] leading-tight font-normal">Show sources</h2>
        <p className="mt-1 text-sm text-ink-soft">Where Air Check finds each show&rsquo;s audio, tracklist and notes. Read-only.</p>
      </div>
      {sources === undefined ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : sources === null ? (
        <p className="text-sm text-ink-soft">
          {workspace === "demo"
            ? "Reading Box, Google Drive and Dropbox is switched off in the demo workspace."
            : "This account can't change source settings. Sign in with your Radio Milwaukee account."}
        </p>
      ) : (
        (["google", "dropbox", "box"] as const).map((source) => (
          <SourceCard key={source} status={sources.find((s) => s.source === source) ?? { source, state: "not_connected" }} />
        ))
      )}
    </div>
  );
}
