// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deepDiveView, notesView, verifyView } from "@/components/research.fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "rj-abc123" }) }));
const results: Record<string, unknown> = {};
const queried: { name: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
  useQuery: (name: string, args: unknown) => {
    queried.push({ name, args });
    return results[name];
  },
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock("../../../../../convex/_generated/api", () => ({
  api: { research: Object.fromEntries(["get", "exportMarkdown", "takeOver", "resume", "regenerate", "editEntry", "setPrivate", "setSuppliedNote"].map((n) => [n, `research.${n}`])) },
}));
vi.mock("@/components/Shell", () => ({
  Shell: ({ title, children }: { title: string; children: React.ReactNode }) => <div><h1>{title}</h1>{children}</div>,
  useWorkspace: () => "real",
}));

import ResearchPage from "./page";

afterEach(() => {
  cleanup();
  for (const k of Object.keys(results)) delete results[k];
  queried.length = 0;
});

describe("Research page", () => {
  it("loading and not found", () => {
    render(<ResearchPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    cleanup();
    results["research.get"] = null;
    render(<ResearchPage />);
    expect(screen.getByText("Research not found")).toBeInTheDocument();
  });

  it("show notes: title, the progress card, the notes and the private export", () => {
    results["research.get"] = notesView();
    results["research.exportMarkdown"] = "# Rhythm Lab Radio 10.30.26";
    render(<ResearchPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Show notes, 10.30.26" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hour 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy for Paper" })).toBeEnabled();
    expect(screen.getByText(/Private\. Never pasted into a Mixcloud description\./)).toBeInTheDocument();
    // The browser's Chicago day goes to the subscribed query (D1).
    expect(queried.find((q) => q.name === "research.get")?.args).toMatchObject({ jobId: "rj-abc123", today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("the agent's last refused saves, in plain words", () => {
    results["research.get"] = notesView({}, { status: "stopped", lastProblems: ["H1.4 is a closing track. Closing tracks are never researched."] });
    render(<ResearchPage />);
    expect(screen.getByRole("heading", { name: "The agent's last refused saves" })).toBeInTheDocument();
    expect(screen.getByText("H1.4 is a closing track. Closing tracks are never researched.")).toBeInTheDocument();
  });

  it("verify and deep dive render their own cards", () => {
    results["research.get"] = verifyView();
    render(<ResearchPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Pre-air check, 10.30.26" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Still open/ })).toBeInTheDocument();
    cleanup();
    results["research.get"] = deepDiveView(5);
    render(<ResearchPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Deep dive: [Artist A]" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connects to your list" })).toBeInTheDocument();
  });
});
