/**
 * Lowercase, strip accents, drop a feat. clause, remove punctuation, collapse spaces. Linear on untrusted text: the
 * feat. pattern takes one whitespace character on each side (the old `\s+…\s+.*$` took 42 s on a 200k-space run),
 * and the rest of the text goes with it, newlines included. Extra spaces fold away in the last pass.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s(?:feat\.|ft\.|featuring)\s.*$/s, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost));
    }
    prev = row;
  }
  return prev[b.length]!;
}
