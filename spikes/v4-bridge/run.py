# Spike V4 end-to-end (throwaway): one Hermes run that calls a Crate tool through the
# private bridge, then package_submit. Writes every raw SSE event as one JSON line.
# Usage (on the VM): HERMES_TOKEN=... python3 run.py body.json events.ndjson
import json, os, sys, time, urllib.request
BASE = "http://127.0.0.1:8642"; TOKEN = os.environ["HERMES_TOKEN"]
body_path, out_path = sys.argv[1], sys.argv[2]

def req(method, path, body=None):
    r = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    return urllib.request.urlopen(r, timeout=600)

fields = json.load(open(body_path))
task = ("Two steps, as two separate tool calls. "
        "1) Use the MusicBrainz artist search tool to look up the artist 'Seun Kuti' and note the top match. "
        "2) Call the package_submit tool exactly once with these fields, copied verbatim (do not edit any value): "
        + json.dumps(fields, ensure_ascii=False)
        + " Then reply with one sentence: the MusicBrainz match name and what package_submit returned.")
run = json.load(req("POST", "/v1/runs", {"input": task}))
rid = run["run_id"]; t0 = time.time(); print("run:", rid)
with req("GET", f"/v1/runs/{rid}/events") as stream, open(out_path, "w") as out:
    event = None
    for raw in stream:
        line = raw.decode().rstrip("\n")
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            payload = line[5:].strip()
            data = json.loads(payload) if payload.startswith("{") else payload
            name = event or (data.get("event") or data.get("type") if isinstance(data, dict) else "?")
            out.write(json.dumps({"t": round(time.time() - t0, 2), "event": name, "data": data}, ensure_ascii=False) + "\n")
            tool = data.get("tool") or data.get("tool_name") or data.get("name") or "" if isinstance(data, dict) else ""
            print(f"{time.time()-t0:6.1f}s  {name}  {tool}")
            if name in ("run.completed", "run.failed", "run.cancelled", "run.interrupted"):
                break
            event = None
time.sleep(2)
st = json.load(req("GET", f"/v1/runs/{rid}"))
print("final status:", st.get("status"), "| usage:", st.get("usage"))
print("output:", str(st.get("output"))[:400])
