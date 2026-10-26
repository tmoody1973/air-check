import { parseTracklist, reconcile } from "../../src/index";
import { readFixture, readPaper } from "./fixtures";

export const goldenTracks = () =>
  reconcile(parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt")), readPaper("raw/10-2-26-paper-tracks.txt"))
    .tracks;
