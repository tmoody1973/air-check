import type { PlayerTrack } from "../components/PlayerProvider";
import type { Workspace } from "../components/Shell";

/** Demo plays the bundled synthetic sample (10 s per "hour"); real has no audio until the media job (Plan 5). */
export function trackFor(workspace: Workspace, title: string): PlayerTrack | null {
  return workspace === "demo"
    ? { src: "/demo/sample-hour.mp3", title, durationSec: 20, hour2AtSec: 10 }
    : null;
}
