// Scripted (demo) replay: a demo run recorded live from the `aircdemo` sandbox on 2026-10-27
// (10-2-26 sample draft through the demo bridge). Source fixture: packages/core/test/fixtures/demo-scripted-run.ndjson
export interface ScriptedEvent { t: number; event: string; data: Record<string, unknown> }

export const SCRIPTED_EVENTS: readonly ScriptedEvent[] = [
  {"t": 7.36, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126559.3610933, "tool": "tool_search", "preview": null}},
  {"t": 7.39, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126559.393383, "tool": "tool_search", "duration": 0.027, "error": false}},
  {"t": 14.38, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126566.3831336, "tool": "tool_describe", "preview": null}},
  {"t": 14.41, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126566.4131463, "tool": "tool_describe", "duration": 0.027, "error": false}},
  {"t": 21.32, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126573.3240688, "tool": "mcp__aircheck__package_submit", "preview": null}},
  {"t": 21.67, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126573.6745417, "tool": "mcp__aircheck__package_submit", "duration": 0.346, "error": false}},
  {"t": 23.16, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.1581607, "delta": "\n\n\nPackage submitted as"}},
  {"t": 23.17, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.1678393, "delta": " demo-10"}},
  {"t": 23.18, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.1785395, "delta": "-2-2"}},
  {"t": 23.19, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.189052, "delta": "6-u9qq"}},
  {"t": 23.2, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.1991053, "delta": "q,"}},
  {"t": 23.21, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.2092628, "delta": " preparing"}},
  {"t": 23.22, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.220705, "delta": " audio. A person"}},
  {"t": 23.23, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.2308187, "delta": " will review it in"}},
  {"t": 23.24, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.2422802, "delta": " the console."}},
  {"t": 23.25, "event": "reasoning.available", "data": {"event": "reasoning.available", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.2487197, "text": "Package submitted as demo-10-2-26-u9qqq, preparing audio. A person will review it in the console."}},
  {"t": 23.27, "event": "run.completed", "data": {"event": "run.completed", "run_id": "run_ee71e718ece84b489a493a5d9d1f0938", "timestamp": 1793126575.2696621, "output": "Package submitted as demo-10-2-26-u9qqq, preparing audio. A person will review it in the console.", "usage": {"input_tokens": 47408, "output_tokens": 3604, "total_tokens": 51012}}},
];
