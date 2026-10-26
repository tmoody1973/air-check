export interface BoxFile {
  id: string;
  name: string;
  size: number;
}

export type AssemblyPattern = "9125-9126" | "29934-29935" | "rlr-full-hour" | "legacy";

export interface EpisodeAssembly {
  status: "ready" | "incomplete" | "ask";
  date: string | null;
  hour1?: BoxFile;
  hour2?: BoxFile;
  pattern?: AssemblyPattern;
  ignored: string[];
  flags: string[];
}

// Order matters: first full pair wins (skills/rlr-box-episode-assembly).
const PATTERNS: { name: AssemblyPattern; h1: RegExp; h2: RegExp }[] = [
  { name: "9125-9126", h1: /^9125\.wav$/i, h2: /^9126\.wav$/i },
  {
    name: "29934-29935",
    h1: /^29934_Rhythm Lab Radio hour 1_Tarik Moody_(\d{6})\.wav$/i,
    h2: /^29935_Rhythm Lab Radio hour 2_Tarik Moody_(\d{6})\.wav$/i,
  },
  { name: "rlr-full-hour", h1: /^RLR\s*-\s*Full Hour 1\s*-\s*(\d{6})\.wav$/i, h2: /^RLR\s*-\s*Full Hour 2\s*-\s*(\d{6})\.wav$/i },
  { name: "legacy", h1: /^9125 - Hour 1\.wav$/i, h2: /^9126 - Hour 2\.wav$/i },
  { name: "legacy", h1: /^Hour One \(9125\)\.wav$/i, h2: /^Hour Two \(9126\)\.wav$/i },
  { name: "legacy", h1: /^9125 - HOUR 1 - FULL\.wav$/i, h2: /^9126 - HOUR 2 - FULL\.wav$/i },
  { name: "legacy", h1: /^9125_(\d{6})\.wav$/i, h2: /^9126_(\d{6})\.wav$/i },
];

const IGNORE = [/^(?:910[1-5]|920[1-5]|9120)\b/, /^RLR Tonight at/i, /^\.DS_Store$/];
const MIN_SIZE = 570_000_000;
const MAX_SIZE = 660_000_000;

function folderDate(name: string): { iso: string; mmddyy: string } | null {
  const m = name.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (!m) return null;
  const [mm, dd, yy] = [m[1]!.padStart(2, "0"), m[2]!.padStart(2, "0"), m[3]!];
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return { iso: `20${yy}-${mm}-${dd}`, mmddyy: `${mm}${dd}${yy}` };
}

function sizeFlags(h1: BoxFile, h2: BoxFile): string[] {
  const flags = [h1, h2].flatMap((h, i) =>
    h.size < MIN_SIZE || h.size > MAX_SIZE ? [`hour ${i + 1} size out of range`] : [],
  );
  if (Math.abs(h1.size - h2.size) > 0.1 * Math.max(h1.size, h2.size)) flags.push("hour sizes differ by more than 10%");
  return flags;
}

export function assembleEpisode(folderName: string, files: BoxFile[]): EpisodeAssembly {
  const date = folderDate(folderName);
  const ignored = files
    .filter((f) => !/\.wav$/i.test(f.name) || IGNORE.some((re) => re.test(f.name)))
    .map((f) => f.name);
  if (!date || /recap|best of/i.test(folderName)) return { status: "ask", date: date?.iso ?? null, ignored, flags: ["special or unparseable folder name"] };

  const candidates = files.filter((f) => !ignored.includes(f.name));
  for (const p of PATTERNS) {
    const h1 = candidates.find((f) => p.h1.test(f.name));
    const h2 = candidates.find((f) => p.h2.test(f.name));
    if (!h1 || !h2) continue;
    const suffixes = [h1.name.match(p.h1)?.[1], h2.name.match(p.h2)?.[1]].filter(Boolean);
    if (suffixes.some((s) => s !== date.mmddyy))
      return { status: "ask", date: date.iso, hour1: h1, hour2: h2, pattern: p.name, ignored, flags: ["date mismatch"] };
    return { status: "ready", date: date.iso, hour1: h1, hour2: h2, pattern: p.name, ignored, flags: sizeFlags(h1, h2) };
  }

  const hour1 = PATTERNS.map((p) => candidates.find((f) => p.h1.test(f.name))).find(Boolean);
  const hour2 = PATTERNS.map((p) => candidates.find((f) => p.h2.test(f.name))).find(Boolean);
  return {
    status: "incomplete",
    date: date.iso,
    ...(hour1 ? { hour1 } : {}),
    ...(hour2 ? { hour2 } : {}),
    ignored,
    flags: [hour1 || hour2 ? "only one hour found" : "no hour files found"],
  };
}
