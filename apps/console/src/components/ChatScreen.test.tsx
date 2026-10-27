// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";

// chat.list -> both conversations; chat.messages -> one user message; runs/packages are skipped.
vi.mock("convex/react", () => ({
  useQuery: (_fn: unknown, args: unknown) =>
    args === "skip" ? undefined
      : args && typeof args === "object" && "conversationId" in args ? [{ _id: "m1", role: "user", text: "hi", at: 1 }]
        : [{ _id: "conv-a", title: "A" }, { _id: "conv-b", title: "B" }],
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/chat" }));
vi.mock("@clerk/nextjs", () => ({ SignOutButton: ({ children }: { children: React.ReactNode }) => children }));

const { ChatScreen } = await import("./ChatScreen");
afterEach(cleanup);

it("a draft typed in one conversation is not carried into another after switching", () => {
  const { rerender } = render(<ChatScreen conversationId="conv-a" />);
  const box = () => screen.getByLabelText("Message Air Check") as HTMLTextAreaElement;
  fireEvent.change(box(), { target: { value: "for conversation A" } });
  rerender(<ChatScreen conversationId="conv-b" />);
  expect(box().value).toBe("");
});
