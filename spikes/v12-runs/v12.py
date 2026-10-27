# Spike V12 (throwaway): stream run events from the Hermes API and stop the run after two tool steps.
import json, os, sys, time, urllib.request, threading
BASE = "http://127.0.0.1:8642"; TOKEN = os.environ["HERMES_TOKEN"]
def req(method, path, body=None):
    r = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    return urllib.request.urlopen(r, timeout=300)
print("capabilities:", json.load(req("GET", "/v1/capabilities")).get("features"))
task = ("Run these six terminal commands one at a time, as six separate tool calls, waiting for each to finish: "
        + "; ".join(f"sleep 5 && echo step-{i}" for i in range(1, 7)) + ". After all six, reply DONE.")
run = json.load(req("POST", "/v1/runs", {"input": task}))
rid = run["run_id"]; t0 = time.time(); print("run:", run)
done_tools = 0; stopped_at = None
with req("GET", f"/v1/runs/{rid}/events") as stream:
    event = None
    for raw in stream:
        line = raw.decode().rstrip("\n")
        if line.startswith("event:"): event = line[6:].strip()
        elif line.startswith("data:"):
            data = json.loads(line[5:]) if line[5:].strip().startswith("{") else line[5:]
            name = event or (data.get("event") or data.get("type") if isinstance(data, dict) else "?")
            info = ""
            if isinstance(data, dict):
                info = data.get("tool") or data.get("tool_name") or data.get("name") or ""
                prev = data.get("preview") or data.get("result_preview") or data.get("args_preview") or ""
                info = f"{info} {str(prev)[:60]}".strip()
            print(f"{time.time()-t0:6.1f}s  {name}  {info}")
            if name == "tool.completed":
                done_tools += 1
                if done_tools == 2 and stopped_at is None:
                    stopped_at = time.time() - t0
                    print(f"{stopped_at:6.1f}s  >>> STOP:", json.load(req("POST", f"/v1/runs/{rid}/stop", {})))
            if name in ("run.completed", "run.failed", "run.cancelled", "run.interrupted"): break
            event = None
time.sleep(2)
st = json.load(req("GET", f"/v1/runs/{rid}"))
print("final status:", st.get("status"), "| tools completed:", done_tools, "| stopped at", stopped_at, "s | usage:", st.get("usage"))
