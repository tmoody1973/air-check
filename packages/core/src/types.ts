export type Hour = 1 | 2;

export interface Track {
  hour: Hour;
  position: number;
  artist: string;
  title: string;
  feat?: string;
  raw: string;
  closing: boolean;
}

export interface BadLine {
  hour: Hour | null;
  line: number;
  raw: string;
  reason: "before-hour-marker" | "no-separator";
}

export interface ParsedTracklist {
  tracks: Track[];
  bad: BadLine[];
}
