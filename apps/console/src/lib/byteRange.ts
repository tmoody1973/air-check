export type ByteRange = { start: number; end: number };

const SPEC = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/;

/**
 * One `Range: bytes=…` spec against a file of `size` bytes (end inclusive). null means send the whole file: no
 * header, or one we can't use (RFC 9110 says ignore it). ponytail: a multi-range request gets the whole file too.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  const m = header ? SPEC.exec(header.trim()) : null;
  if (!m) return null;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const n = Number(b);
    return n === 0 || size === 0 ? "unsatisfiable" : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (b !== "" && Number(b) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: b === "" ? size - 1 : Math.min(Number(b), size - 1) };
}
