import { fingerprint } from "./fingerprint";
import type { PackageDraft } from "./mixcloud";

export type PackageStatus =
  | "preparing_audio"
  | "awaiting_review"
  | "approved"
  | "skipped"
  | "publishing"
  | "succeeded"
  | "failed"
  | "outcome_unknown";

export interface PackageRecord {
  draft: PackageDraft;
  status: PackageStatus;
  fingerprint?: string;
  decidedBy?: string;
  decidedAt?: string;
  /** `at` is when the publisher reported the result (ISO); it paces the 3-per-day limit. */
  result?: { url?: string; error?: string; at?: string };
}

export interface PackageStore {
  get(id: string): Promise<PackageRecord | null>;
  put(rec: PackageRecord): Promise<void>;
  compareAndSwap(
    id: string,
    expected: { status: PackageStatus; fingerprint?: string },
    next: Partial<PackageRecord>,
  ): Promise<PackageRecord | null>;
}

/** `demo` is the judges' demo login: it may decide demo packages only. */
export type Actor = { kind: "human"; userId: string; email: string } | { kind: "demo"; userId: string } | { kind: "agent" };

export interface AudioRef {
  hour1Id: string;
  hour2Id: string;
  mp3Sha256: string;
  /** Derived from the MP3, so it is stored but not fingerprinted. */
  hour1DurationSec?: number;
  /** Size of the prepared MP3, for the publisher's pre-upload checks. Not fingerprinted (the hash already covers the file). */
  mp3Bytes?: number;
}

export interface Transition {
  id: string;
  from: PackageStatus | null;
  to: PackageStatus;
  by: string;
  at: string;
}

export type GateErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PACKAGE_CHANGED"
  | "NOT_READY"
  | "DEMO_CANNOT_PUBLISH"
  | "ALREADY_EXISTS"
  | "BAD_INPUT";

export class GateError extends Error {
  constructor(
    readonly code: GateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GateError";
  }
}

export const APPROVER_DOMAIN = "@radiomilwaukee.org";
const DECIDED: readonly PackageStatus[] = ["approved", "skipped", "publishing", "succeeded", "failed", "outcome_unknown"];

export type PublishResult =
  | { status: "succeeded"; url: string }
  | { status: "failed"; error: string }
  | { status: "outcome_unknown" };

function mayDecide(actor: Actor, workspace: PackageDraft["workspace"]): boolean {
  if (actor.kind === "human") return actor.email.toLowerCase().endsWith(APPROVER_DOMAIN);
  return actor.kind === "demo" && workspace === "demo";
}

/** The publisher's failure codes for the MP3 itself. Reopening one of these rebuilds the MP3 (Tarik's ruling). */
export const AUDIO_CHANGED = "audio_changed";
export const AUDIO_MISSING = "audio_missing";
const AUDIO_FAILURES: readonly string[] = [AUDIO_CHANGED, AUDIO_MISSING];

/** A show's address on Mixcloud's own site (the only receipt URL the console links). */
export const MIXCLOUD_SHOW_PREFIX = "https://www.mixcloud.com/";

function actorName(actor: Actor): string {
  return actor.kind === "human" ? actor.email : actor.kind === "demo" ? `demo:${actor.userId}` : "agent";
}

/**
 * The MP3 hash is set only by attachAudio (the media job), and the cover only by setCover (a human),
 * never by the agent's draft. `coverStorageId` is the record's own cover (undefined on submit).
 */
function agentDraft(draft: PackageDraft, coverStorageId?: string): PackageDraft {
  const { hour1Id, hour2Id } = draft.audio;
  return { ...draft, audio: { hour1Id, hour2Id }, coverStorageId };
}

export function canPublish(rec: PackageRecord): boolean {
  return rec.status === "approved" && rec.draft.workspace === "real";
}

/**
 * Hard Rule 1: the agent can submit and revise; only a signed-in @radiomilwaukee.org human can decide
 * (the demo login can decide demo packages, which never publish).
 * No time expiry (spec 5.4). Nothing is retried automatically.
 */
export class ApprovalGate {
  private readonly now: () => Date;
  private readonly onTransition: (t: Transition) => Promise<void>;

  constructor(
    private readonly store: PackageStore,
    opts: { now?: () => Date; onTransition?: (t: Transition) => Promise<void> } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.onTransition = opts.onTransition ?? (async () => {});
  }

  private async emit(id: string, from: PackageStatus | null, to: PackageStatus, by: string) {
    await this.onTransition({ id, from, to, by, at: this.now().toISOString() });
  }

  private async load(id: string): Promise<PackageRecord> {
    const rec = await this.store.get(id);
    if (!rec) throw new GateError("NOT_FOUND", `package ${id} not found`);
    return rec;
  }

  async submit(draft: PackageDraft): Promise<PackageRecord> {
    if (await this.store.get(draft.id)) throw new GateError("ALREADY_EXISTS", `package ${draft.id} already exists`);
    const rec: PackageRecord = { draft: agentDraft(draft), status: "preparing_audio" };
    await this.store.put(rec);
    await this.emit(draft.id, null, rec.status, "agent");
    return rec;
  }

  async attachAudio(id: string, audio: AudioRef): Promise<PackageRecord> {
    const cur = await this.load(id);
    if (audio.hour1Id !== cur.draft.audio.hour1Id || audio.hour2Id !== cur.draft.audio.hour2Id)
      throw new GateError("PACKAGE_CHANGED", `MP3 for ${id} was made from different hour files`);
    const draft = { ...cur.draft, audio: { ...audio } };
    const next = await this.store.compareAndSwap(
      id,
      { status: "preparing_audio" },
      { draft, status: "awaiting_review", fingerprint: await fingerprint(draft) },
    );
    if (!next) throw new GateError("NOT_READY", `package ${id} is not waiting for audio`);
    await this.emit(id, "preparing_audio", "awaiting_review", "media");
    return next;
  }

  async revise(id: string, draft: PackageDraft): Promise<PackageRecord> {
    const cur = await this.load(id);
    if (cur.status !== "awaiting_review") throw new GateError("NOT_READY", `package ${id} cannot be revised now`);
    const sameAudio = draft.audio.hour1Id === cur.draft.audio.hour1Id && draft.audio.hour2Id === cur.draft.audio.hour2Id;
    // ponytail: the existing MP3 is carried over only when the source hours are unchanged; otherwise audio is prepared again
    const { mp3Sha256, hour1DurationSec, mp3Bytes } = sameAudio ? cur.draft.audio : ({} as Partial<AudioRef>);
    // id, workspace, show date and cover belong to the record, never to the agent's revision
    const base = agentDraft({ ...draft, id, workspace: cur.draft.workspace, showDate: cur.draft.showDate }, cur.draft.coverStorageId);
    const revised = mp3Sha256 ? { ...base, audio: { ...base.audio, mp3Sha256, hour1DurationSec, mp3Bytes } } : base;
    const patch: Partial<PackageRecord> = mp3Sha256
      ? { draft: revised, status: "awaiting_review", fingerprint: await fingerprint(revised) }
      : { draft: revised, status: "preparing_audio", fingerprint: undefined };
    const next = await this.store.compareAndSwap(id, { status: "awaiting_review", fingerprint: cur.fingerprint }, patch);
    if (!next) throw new GateError("PACKAGE_CHANGED", `package ${id} changed while revising`);
    await this.emit(id, "awaiting_review", next.status, "agent");
    return next;
  }

  async decide(id: string, fp: string, decision: "approve" | "skip", actor: Actor): Promise<PackageRecord> {
    if (actor.kind === "agent") throw new GateError("FORBIDDEN", "the agent cannot decide");
    const cur = await this.load(id);
    if (!mayDecide(actor, cur.draft.workspace))
      throw new GateError("FORBIDDEN", "only a signed-in Radio Milwaukee user can decide");
    if (DECIDED.includes(cur.status)) return cur;
    if (cur.status === "preparing_audio") throw new GateError("NOT_READY", "audio is still being prepared");
    if (cur.fingerprint !== fp) throw new GateError("PACKAGE_CHANGED", "This package changed. Open the latest version.");
    const to: PackageStatus = decision === "approve" ? "approved" : "skipped";
    const next = await this.store.compareAndSwap(
      id,
      { status: "awaiting_review", fingerprint: fp },
      { status: to, decidedBy: actorName(actor), decidedAt: this.now().toISOString() },
    );
    if (!next) return this.load(id);
    await this.emit(id, "awaiting_review", to, actorName(actor));
    return next;
  }

  /** A signed-in human picks (or clears, with null) the cover. It goes public, so the package re-fingerprints. */
  async setCover(id: string, coverStorageId: string | null, actor: Actor): Promise<PackageRecord> {
    if (actor.kind !== "human" || !mayDecide(actor, "real"))
      throw new GateError("FORBIDDEN", "only a signed-in Radio Milwaukee user can change the cover");
    const cur = await this.load(id);
    if (cur.status !== "awaiting_review") throw new GateError("NOT_READY", `the cover of ${id} cannot change now`);
    const draft = { ...cur.draft, coverStorageId: coverStorageId ?? undefined };
    const next = await this.store.compareAndSwap(
      id,
      { status: "awaiting_review", fingerprint: cur.fingerprint },
      { draft, fingerprint: await fingerprint(draft) },
    );
    if (!next) throw new GateError("PACKAGE_CHANGED", `package ${id} changed while setting the cover`);
    return next;
  }

  /** reopen and confirmPosted settle a finished upload: a signed-in real-workspace human only (never agent or demo). */
  private requireStaff(actor: Actor): void {
    if (actor.kind !== "human" || !mayDecide(actor, "real"))
      throw new GateError("FORBIDDEN", "only a signed-in Radio Milwaukee user can do this");
  }

  /**
   * failed or outcome_unknown -> awaiting_review, so a human can fix what went wrong and approve again. A failure of
   * the MP3 itself (changed or missing) goes to preparing_audio instead, with only the hour ids kept, so media
   * rebuilds the MP3 from the inbox. Hard Rule 1: this never yields approved; decision, result and fingerprint start over.
   */
  async reopen(id: string, actor: Actor): Promise<PackageRecord> {
    this.requireStaff(actor);
    const cur = await this.load(id);
    if (cur.status !== "failed" && cur.status !== "outcome_unknown")
      throw new GateError("NOT_READY", `package ${id} can only be reopened after a failed or uncertain upload`);
    const cleared = { result: undefined, decidedBy: undefined, decidedAt: undefined };
    const rebuild = cur.status === "failed" && AUDIO_FAILURES.includes(cur.result?.error ?? "");
    const { hour1Id, hour2Id } = cur.draft.audio;
    const patch: Partial<PackageRecord> = rebuild
      ? { ...cleared, status: "preparing_audio", draft: { ...cur.draft, audio: { hour1Id, hour2Id } }, fingerprint: undefined }
      : { ...cleared, status: "awaiting_review", fingerprint: await fingerprint(cur.draft) };
    const next = await this.store.compareAndSwap(id, { status: cur.status, fingerprint: cur.fingerprint }, patch);
    if (!next) throw new GateError("PACKAGE_CHANGED", `package ${id} changed while reopening`);
    await this.emit(id, cur.status, next.status, actorName(actor));
    return next;
  }

  /**
   * outcome_unknown -> succeeded: a human checked Mixcloud and the show is there. `at` is when they confirmed (the
   * real post time is unknown), and it counts toward that Chicago day's pacing like any other success.
   */
  async confirmPosted(id: string, url: string, actor: Actor): Promise<PackageRecord> {
    this.requireStaff(actor);
    if (!url.startsWith(MIXCLOUD_SHOW_PREFIX) || url.length <= MIXCLOUD_SHOW_PREFIX.length)
      throw new GateError("BAD_INPUT", `the show's address must start with ${MIXCLOUD_SHOW_PREFIX}`);
    const cur = await this.load(id);
    if (cur.status !== "outcome_unknown") throw new GateError("NOT_READY", `package ${id} is not waiting for a check on Mixcloud`);
    const next = await this.store.compareAndSwap(
      id,
      { status: "outcome_unknown" },
      { status: "succeeded", result: { url, at: this.now().toISOString() } },
    );
    if (!next) throw new GateError("PACKAGE_CHANGED", `package ${id} changed while confirming`);
    await this.emit(id, "outcome_unknown", "succeeded", actorName(actor));
    return next;
  }

  async claimForPublish(id: string): Promise<PackageRecord | null> {
    const cur = await this.load(id);
    if (cur.draft.workspace !== "real") throw new GateError("DEMO_CANNOT_PUBLISH", "demo packages never publish");
    if (cur.status !== "approved") return null;
    const next = await this.store.compareAndSwap(id, { status: "approved", fingerprint: cur.fingerprint }, { status: "publishing" });
    if (next) await this.emit(id, "approved", "publishing", "publisher");
    return next;
  }

  /**
   * publishing -> approved, the one way back to approved, and only when nothing was sent: Mixcloud rejected the access
   * token before it took any audio (`invalid_token`), or the publisher lost the claim's answer and never started the
   * upload (M3; it reuses the same call). The package waits, still approved as Tarik approved it.
   */
  async unclaim(id: string, reason: "invalid_token"): Promise<PackageRecord> {
    void reason;
    const next = await this.store.compareAndSwap(id, { status: "publishing" }, { status: "approved" });
    if (!next) throw new GateError("NOT_READY", `package ${id} is not publishing`);
    await this.emit(id, "publishing", "approved", "publisher");
    return next;
  }

  async recordResult(id: string, r: PublishResult): Promise<PackageRecord> {
    const at = this.now().toISOString();
    const result = r.status === "succeeded" ? { url: r.url, at } : r.status === "failed" ? { error: r.error, at } : { at };
    const next = await this.store.compareAndSwap(id, { status: "publishing" }, { status: r.status, result });
    if (!next) throw new GateError("NOT_READY", `package ${id} is not publishing`);
    await this.emit(id, "publishing", r.status, "publisher");
    return next;
  }
}
