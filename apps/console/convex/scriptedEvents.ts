// Placeholder events for scripted (demo) replays: the real Hermes run captured 2026-10-27
// (packages/core/test/fixtures/hermes-run-events.ndjson). Task 9 replaces this with a recorded demo run.
export interface ScriptedEvent { t: number; event: string; data: Record<string, unknown> }

export const SCRIPTED_EVENTS: readonly ScriptedEvent[] = [
  {"t": 6.24, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077900.015046, "tool": "tool_search", "preview": null}},
  {"t": 6.27, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077900.0492558, "tool": "tool_search", "duration": 0.042, "error": false}},
  {"t": 8.0, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077901.7756915, "tool": "mcp__crate__musicbrainz_search_artist", "preview": "Seun Kuti"}},
  {"t": 9.48, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077903.2533364, "tool": "mcp__crate__musicbrainz_search_artist", "duration": 1.469, "error": false}},
  {"t": 11.27, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077905.04646, "tool": "tool_search", "preview": null}},
  {"t": 11.29, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077905.07109, "tool": "tool_search", "duration": 0.022, "error": false}},
  {"t": 15.59, "event": "tool.started", "data": {"event": "tool.started", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077909.368657, "tool": "mcp__aircheck__package_submit", "preview": null}},
  {"t": 16.01, "event": "tool.completed", "data": {"event": "tool.completed", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077909.7854574, "tool": "mcp__aircheck__package_submit", "duration": 0.412, "error": false}},
  {"t": 17.85, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.6286669, "delta": "\n\n\n\nSeun K"}},
  {"t": 17.86, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.6396246, "delta": "uti – Submitted"}},
  {"t": 17.87, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.650051, "delta": " pkg-10"}},
  {"t": 17.88, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.661119, "delta": "-9-2"}},
  {"t": 17.89, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.6714237, "delta": "6 (preparing"}},
  {"t": 17.9, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.6823823, "delta": " audio). A person"}},
  {"t": 17.91, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.6934085, "delta": " reviews it in the"}},
  {"t": 17.93, "event": "message.delta", "data": {"event": "message.delta", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.7055855, "delta": " console."}},
  {"t": 17.93, "event": "reasoning.available", "data": {"event": "reasoning.available", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.7114902, "text": "Seun Kuti – Submitted pkg-10-9-26 (preparing audio). A person reviews it in the console."}},
  {"t": 17.95, "event": "run.completed", "data": {"event": "run.completed", "run_id": "run_71f865226db3481ab20181e0e475a685", "timestamp": 1793077911.7312827, "output": "Seun Kuti – Submitted pkg-10-9-26 (preparing audio). A person reviews it in the console.", "usage": {"input_tokens": 85704, "output_tokens": 1621, "total_tokens": 87325}}},
];
