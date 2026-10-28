import { describe, expect, it, vi } from "vitest";
import { coverProblem, uploadCover } from "./cover";

const file = (type: string, size = 10) => new File([new Uint8Array(size)], "c", { type });

describe("coverProblem", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("%s up to 10 MB is fine", (type) => {
    expect(coverProblem({ type, size: 10 * 1024 ** 2 })).toBeNull();
  });
  it.each(["image/gif", "image/svg+xml", "application/pdf", ""])("%s is refused", (type) => {
    expect(coverProblem({ type, size: 10 })).toBe("Use a JPEG, PNG or WebP image.");
  });
  it("over 10 MB is refused", () => {
    expect(coverProblem({ type: "image/png", size: 10 * 1024 ** 2 + 1 })).toBe("Use an image under 10 MB.");
  });
});

describe("uploadCover", () => {
  const record = { status: "awaiting_review", fingerprint: "fp2" } as never;

  it("posts the file to the one-time URL, then calls setCover with the storage id", async () => {
    const post = vi.fn(async () => new Response(JSON.stringify({ storageId: "st1" }), { status: 200 }));
    const setCover = vi.fn(async () => ({ ok: true as const, record }));
    const f = file("image/png");
    const res = await uploadCover(f, { uploadUrl: async () => "https://convex.example/upload?token=1", setCover, post });
    expect(post).toHaveBeenCalledWith("https://convex.example/upload?token=1", { method: "POST", headers: { "Content-Type": "image/png" }, body: f });
    expect(setCover).toHaveBeenCalledWith("st1");
    expect(res).toEqual({ ok: true, record });
  });

  it("a bad file never uploads", async () => {
    const uploadUrl = vi.fn(async () => "u");
    const res = await uploadCover(file("image/gif"), { uploadUrl, setCover: vi.fn(), post: vi.fn() });
    expect(res).toEqual({ ok: false, message: "Use a JPEG, PNG or WebP image." });
    expect(uploadUrl).not.toHaveBeenCalled();
  });

  it("a failed upload or a refused setCover is a message, not a throw", async () => {
    const setCover = vi.fn();
    const bad = await uploadCover(file("image/png"), { uploadUrl: async () => "u", setCover, post: async () => new Response("x", { status: 500 }) });
    expect(bad).toEqual({ ok: false, message: "The upload failed. Try again." });
    expect(setCover).not.toHaveBeenCalled();
    const refused = await uploadCover(file("image/png"), {
      uploadUrl: async () => "u",
      setCover: async () => ({ ok: false as const, code: "NOT_READY", message: "the cover of p1 cannot change now" }),
      post: async () => new Response(JSON.stringify({ storageId: "st1" })),
    });
    expect(refused).toEqual({ ok: false, message: "the cover of p1 cannot change now" });
  });
});
