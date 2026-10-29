import { formatTracklist, type PackageDraft, parseTracklist, reconcile } from "../../src/index";
import { goldenDescription, goldenPackageTitles, readFixture, readPaper } from "./fixtures";

export const goldenTracks = () =>
  reconcile(parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt")), readPaper("raw/10-2-26-paper-tracks.txt"))
    .tracks;

export const goldenTitles = () => goldenTracks().map((t) => t.title);

export const goldenDraft = (overrides: Partial<PackageDraft> = {}): PackageDraft => ({
  id: "pkg-10-2-26",
  workspace: "real",
  showDate: "2026-10-02",
  title: goldenPackageTitles()[0]!,
  tags: ["Jazz", "Electronic", "R&B", "Soul", "Hip Hop"],
  description: goldenDescription(),
  tracks: goldenTracks(),
  audio: { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: "a".repeat(64) },
  ...overrides,
});

/**
 * R6: the finished draft-package run that asked for a draft's tracks. Convex's packages.submit refuses a package whose
 * tracks differ from the latest such run for its show and workspace, so console tests insert one before submitting.
 */
export const draftRunFor = (d: Pick<PackageDraft, "workspace" | "showDate" | "tracks">, tracklistText = formatTracklist(d.tracks), createdAt = 1) => ({
  workspace: d.workspace, runId: `run-${d.workspace}-${d.showDate}-${createdAt}`, title: `Draft package · ${d.showDate}`, state: {}, updatedAt: createdAt,
  kind: "draft-package" as const, status: "completed" as const, form: { showDate: d.showDate, tracklistText, notes: "" }, createdAt,
});
