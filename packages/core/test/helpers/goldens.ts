import { type PackageDraft, parseTracklist, reconcile } from "../../src/index";
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
