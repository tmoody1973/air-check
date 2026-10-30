// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deepDiveView, notesView, verifyView } from "@/components/research.fixture";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "rj-abc123" }), useRouter: () => ({ push }) }));
const results: Record<string, unknown> = {};
const mutations: Record<string, (args: unknown) => Promise<unknown>> = {};
const queried: { name: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
  useQuery: (name: string, args: unknown) => {
    queried.push({ name, args });
    return results[name];
  },
  useMutation: (name: string) => mutations[name] ?? vi.fn(),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock("../../../../../convex/_generated/api", () => ({
  api: { research: Object.fromEntries(["get", "exportMarkdown", "takeOver", "resume", "regenerate", "editEntry", "setPrivate", "setSuppliedNote", "startVerify"].map((n) => [n, `research.${n}`])) },
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
  for (const k of Object.keys(mutations)) delete mutations[k];
  push.mockReset();
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

  it("I3: Pre-air verify on done show notes checks Air Check's own notes, then opens the new job", async () => {
    const startVerify = vi.fn(async () => ({ jobId: "rj-verify1", runId: "run-9" }));
    mutations["research.startVerify"] = startVerify;
    results["research.get"] = notesView({ progress: { done: 8, total: 8 } }, { status: "done" });
    render(<ResearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Pre-air verify" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/research/rj-verify1"));
    expect(startVerify).toHaveBeenCalledWith({ showDate: "2026-10-30", notes: { from: "air-check" } });
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
