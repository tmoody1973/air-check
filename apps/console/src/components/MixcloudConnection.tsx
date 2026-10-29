import type { MixcloudStatus } from "../../convex/mixcloud";
import { chicagoDateLabel } from "../lib/date";
import type { ErrorReason } from "../lib/mixcloudOAuth";
import type { Workspace } from "./Shell";

export type MixcloudNotice =
  | { kind: "connected" }
  | { kind: "disconnected" }
  | { kind: "error"; reason: ErrorReason | "unknown" }
  | null;

/** The outcome the OAuth routes put in /settings?mixcloud=…; an unknown reason never echoes the URL's text. */
export function noticeFrom(params: URLSearchParams): MixcloudNotice {
  const v = params.get("mixcloud");
  if (v === "connected" || v === "disconnected") return { kind: v };
  if (v !== "error") return null;
  const reason = params.get("reason") ?? "";
  return { kind: "error", reason: Object.hasOwn(ERROR_TEXT, reason) ? (reason as ErrorReason) : "unknown" };
}

const ERROR_TEXT: Record<ErrorReason | "unknown", string> = {
  state: "That sign-in link expired or was opened in another browser. Connect again from here.",
  denied: "Mixcloud did not give access. Connect again if that was a mistake.",
  exchange: "Mixcloud did not accept the sign-in. Try connecting again.",
  profile: "Could not read the Mixcloud account name. Try connecting again.",
  write: "The server could not save the Mixcloud key. Check the token folder's owner and mode (docs/DEPLOY.md).",
  status: "The connection status did not save. Try again.",
  config: "Mixcloud is not set up on the server yet: the app settings are missing.",
  unknown: "Something went wrong with Mixcloud. Try again.",
};

export const BTN =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-control border px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

function Notice({ notice }: { notice: NonNullable<MixcloudNotice> }) {
  if (notice.kind === "error")
    return (
      <p role="alert" className="rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">
        {ERROR_TEXT[notice.reason]}
      </p>
    );
  return (
    <p role="status" className="rounded-control bg-signal-soft px-4 py-3 text-sm text-signal-deep">
      {notice.kind === "connected" ? "Mixcloud is connected." : "Mixcloud is disconnected. The key was deleted from the server."}
    </p>
  );
}

// Word plus color: the line states the connection; the square only repeats it (sidebar marker shape).
function StatusLine({ status }: { status: MixcloudStatus }) {
  const [mark, text, tone] =
    status.state === "connected"
      ? ["bg-signal", `Connected as ${status.account ?? "[account]"} · since ${status.connectedAt ? chicagoDateLabel(status.connectedAt) : "[date]"}`, "text-ink"]
      : status.state === "needs_reconnect"
        ? ["bg-problem-text", "Reconnect needed: Mixcloud says the permission was revoked", "text-problem-text"]
        : ["bg-line-strong", "Not connected", "text-ink"];
  return <StatusMark mark={mark} text={text} tone={tone} />;
}

/** One status line: the words carry the state; the square repeats it in color (Word Plus Color Rule). */
export function StatusMark({ mark, text, tone }: { mark: string; text: string; tone: string }) {
  return (
    <p className={`flex items-baseline gap-2.5 text-[15px] font-medium ${tone}`}>
      <span aria-hidden="true" className={`size-2 shrink-0 translate-y-[-1px] rounded-[2px] ${mark}`} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </p>
  );
}

export function MixcloudConnection({
  status,
  workspace,
  notice = null,
}: {
  /** undefined = loading; null = not allowed to see it (demo or not staff). */
  status: MixcloudStatus | null | undefined;
  workspace: Workspace;
  notice?: MixcloudNotice;
}) {
  return (
    <div className="mx-auto flex max-w-xl min-w-0 flex-col gap-4">
      {notice && <Notice notice={notice} />}
      <section aria-labelledby="mixcloud-heading" className="rounded-card border border-line bg-surface p-5">
        <h2 id="mixcloud-heading" className="font-serif text-[24px] leading-tight font-normal">Mixcloud</h2>
        <div className="mt-3 flex flex-col gap-2">
          {status === undefined ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : status === null ? (
            <p className="text-sm text-ink-soft">
              {workspace === "demo"
                ? "Publishing to Mixcloud is switched off in the demo workspace."
                : "This account can't change Mixcloud settings. Sign in with your Radio Milwaukee account."}
            </p>
          ) : (
            <>
              <StatusLine status={status} />
              <p className="text-[13px] leading-snug text-muted">
                Approved shows post to this account. The key is kept in a locked file on the server that
                only the publisher reads. The agent never holds it.
              </p>
            </>
          )}
        </div>
        {status && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {/* Same-origin POST forms, not links: a cross-site page can't start or end a connection. */}
            <form method="post" action="/api/mixcloud/authorize">
              <button type="submit" className={`${BTN} border-signal bg-signal text-white hover:bg-signal-deep`}>
                {status.state === "not_connected" ? "Connect Mixcloud" : "Reconnect"}
              </button>
            </form>
            {status.state !== "not_connected" && (
              <form method="post" action="/api/mixcloud/disconnect">
                <button type="submit" className={`${BTN} border-line-strong bg-surface text-ink hover:bg-chip`}>
                  Disconnect
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
