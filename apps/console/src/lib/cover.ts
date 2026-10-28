import type { PackageRecord } from "@aircheck/core";

// The publisher refuses covers over 10 MB (apps/publisher MAX_COVER_BYTES); Mixcloud takes these three types.
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 ** 2;

export type CoverChangeResult = { ok: true; record: PackageRecord } | { ok: false; message: string };

export function coverProblem(file: { type: string; size: number }): string | null {
  if (!TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (file.size > MAX_BYTES) return "Use an image under 10 MB.";
  return null;
}

type SetCoverResult = { ok: true; record: PackageRecord } | { ok: false; code: string; message: string };

/** Convex's two-step upload: a one-time URL, POST the file, then setCover with the new storage id. */
export async function uploadCover(
  file: File,
  deps: { uploadUrl: () => Promise<string>; setCover: (storageId: string) => Promise<SetCoverResult>; post?: typeof fetch },
): Promise<CoverChangeResult> {
  const problem = coverProblem(file);
  if (problem) return { ok: false, message: problem };
  const failed = { ok: false, message: "The upload failed. Try again." } as const;
  try {
    const res = await (deps.post ?? fetch)(await deps.uploadUrl(), { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) return failed;
    const { storageId } = (await res.json()) as { storageId?: unknown };
    if (typeof storageId !== "string") return failed;
    const r = await deps.setCover(storageId);
    return r.ok ? { ok: true, record: r.record } : { ok: false, message: r.message };
  } catch {
    return failed;
  }
}
