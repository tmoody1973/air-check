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
  result?: { url?: string; error?: string };
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

export type Actor = { kind: "human"; userId: string; email: string } | { kind: "agent" };

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
  | "ALREADY_EXISTS";

export class GateError extends Error {
  constructor(
    readonly code: GateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GateError";
  }
}

const APPROVER_DOMAIN = "@radiomilwaukee.org";
const DECIDED: readonly PackageStatus[] = ["approved", "skipped", "publishing", "succeeded", "failed", "outcome_unknown"];

export type PublishResult =
  | { status: "succeeded"; url: string }
  | { status: "failed"; error: string }
  | { status: "outcome_unknown" };

export function canPublish(rec: PackageRecord): boolean {
  return rec.status === "approved" && rec.draft.workspace === "real";
}

/**
 * Hard Rule 1: the agent can submit and revise; only a signed-in @radiomilwaukee.org human can decide.
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
    const rec: PackageRecord = draft.audio.mp3Sha256
      ? { draft, status: "awaiting_review", fingerprint: fingerprint(draft) }
      : { draft, status: "preparing_audio" };
    await this.store.put(rec);
    await this.emit(draft.id, null, rec.status, "agent");
    return rec;
  }

  async attachAudio(id: string, mp3Sha256: string): Promise<PackageRecord> {
    const cur = await this.load(id);
    const draft = { ...cur.draft, audio: { ...cur.draft.audio, mp3Sha256 } };
    const next = await this.store.compareAndSwap(
      id,
      { status: "preparing_audio" },
      { draft, status: "awaiting_review", fingerprint: fingerprint(draft) },
    );
    if (!next) throw new GateError("NOT_READY", `package ${id} is not waiting for audio`);
    await this.emit(id, "preparing_audio", "awaiting_review", "media");
    return next;
  }

  async revise(id: string, draft: PackageDraft): Promise<PackageRecord> {
    const cur = await this.load(id);
    if (cur.status !== "awaiting_review") throw new GateError("NOT_READY", `package ${id} cannot be revised now`);
    const sameAudio = draft.audio.hour1Id === cur.draft.audio.hour1Id && draft.audio.hour2Id === cur.draft.audio.hour2Id;
    // ponytail: an MP3 is only carried over when the source hours are unchanged; otherwise audio is prepared again
    const mp3Sha256 = sameAudio ? (draft.audio.mp3Sha256 ?? cur.draft.audio.mp3Sha256) : draft.audio.mp3Sha256;
    const revised = { ...draft, id, audio: { ...draft.audio, mp3Sha256 } };
    const patch: Partial<PackageRecord> = mp3Sha256
      ? { draft: revised, status: "awaiting_review", fingerprint: fingerprint(revised) }
      : { draft: revised, status: "preparing_audio", fingerprint: undefined };
    const next = await this.store.compareAndSwap(id, { status: "awaiting_review", fingerprint: cur.fingerprint }, patch);
    if (!next) throw new GateError("PACKAGE_CHANGED", `package ${id} changed while revising`);
    await this.emit(id, "awaiting_review", next.status, "agent");
    return next;
  }

  async decide(id: string, fp: string, decision: "approve" | "skip", actor: Actor): Promise<PackageRecord> {
    if (actor.kind !== "human" || !actor.email.toLowerCase().endsWith(APPROVER_DOMAIN))
      throw new GateError("FORBIDDEN", "only a signed-in Radio Milwaukee user can decide");
    const cur = await this.load(id);
    if (DECIDED.includes(cur.status)) return cur;
    if (cur.status === "preparing_audio") throw new GateError("NOT_READY", "audio is still being prepared");
    if (cur.fingerprint !== fp) throw new GateError("PACKAGE_CHANGED", "This package changed. Open the latest version.");
    const to: PackageStatus = decision === "approve" ? "approved" : "skipped";
    const next = await this.store.compareAndSwap(
      id,
      { status: "awaiting_review", fingerprint: fp },
      { status: to, decidedBy: actor.email, decidedAt: this.now().toISOString() },
    );
    if (!next) return this.load(id);
    await this.emit(id, "awaiting_review", to, actor.email);
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

  async recordResult(id: string, r: PublishResult): Promise<PackageRecord> {
    const result = r.status === "succeeded" ? { url: r.url } : r.status === "failed" ? { error: r.error } : {};
    const next = await this.store.compareAndSwap(id, { status: "publishing" }, { status: r.status, result });
    if (!next) throw new GateError("NOT_READY", `package ${id} is not publishing`);
    await this.emit(id, "publishing", r.status, "publisher");
    return next;
  }
}
