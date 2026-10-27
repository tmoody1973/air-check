export type StepStatus = "working" | "done" | "error";
export interface RunStep { id: string; tool: string; preview: string; status: StepStatus; startedAt: number; durationSec?: number;
  /** Display-only: position label such as "H1.4" and source chips. The reducer never reads or writes them. */
  label?: string; sources?: string[] }
export interface RunState {
  runId: string;
  status: "running" | "stopping" | "completed" | "cancelled" | "failed" | "interrupted";
  steps: RunStep[];
  interim?: string;
  /** Assistant chat reply, built from message.delta chunks in order. */
  reply?: string;
  output?: string;
}

const PREVIEW_MAX = 80;

export function initialRun(runId: string): RunState {
  return { runId, status: "running", steps: [] };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Field names follow spike V12: `tool`, `preview`; `error` and `duration` are tolerated if absent.
export function applyRunEvent(state: RunState, event: string, data: Record<string, unknown>, at: number): RunState {
  switch (event) {
    case "tool.started": {
      const tool = str(data.tool) || str(data.tool_name) || str(data.name);
      const preview = (str(data.preview) || str(data.args_preview)).slice(0, PREVIEW_MAX);
      const step: RunStep = { id: `${state.runId}-${state.steps.length}`, tool, preview, status: "working", startedAt: at };
      return { ...state, steps: [...state.steps, step] };
    }
    case "tool.completed": {
      const tool = str(data.tool) || str(data.tool_name) || str(data.name);
      const i = state.steps.findIndex((s) => s.status === "working" && s.tool === tool);
      if (i < 0) return state;
      const durationSec = typeof data.duration === "number" ? data.duration : undefined;
      const status: StepStatus = data.error === true ? "error" : "done";
      const steps = state.steps.map((s, j) => (j === i ? { ...s, status, ...(durationSec !== undefined && { durationSec }) } : s));
      return { ...state, steps };
    }
    case "message.interim":
      return { ...state, interim: str(data.text) || str(data.message) };
    case "message.delta":
      return { ...state, reply: (state.reply ?? "") + str(data.delta) };
    case "run.completed":
      return { ...state, status: "completed", output: str(data.output) };
    case "run.cancelled":
    case "run.failed":
    case "run.interrupted":
      return { ...state, status: event.slice(4) as RunState["status"] };
    default:
      return state;
  }
}
