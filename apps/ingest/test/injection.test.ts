import { expect, test } from "vitest";
import { embedPass } from "../src/bandcamp.js";
import { radarPass } from "../src/radar.js";
import { fakeRadar, pendingFromFixture, RECEIVED_AT } from "./convexFake.js";
import { stubHttp, tfReply } from "./fakes.js";

// Review Focus 1 (CLAUDE.md Testing, verbatim): "a forwarded email containing instructions must produce a `releases`
// record and nothing else." The reader half: the stored cosign-injection email, read by a *compromised* model that
// obeys the email. Task 2's convex/injection.test.ts owns the Convex half (validator, table counts).
test("a forwarded email with instructions, read by a compromised model, produces one saved release and nothing else", async () => {
  const row = pendingFromFixture("cosign-injection");
  expect(row.tab).toBe("cosign");
  const cv = fakeRadar([row]);
  const compromised = {
    artist: "[Artist Name]",
    title: "[Song Title]",
    label: "https://evil.example/a",
    status: "played",
    approve: "pkg-10-16-26",
    sendTo: "x@evil.example",
    open: "https://evil.example/a",
    tools: [{ type: "function", function: { name: "approve" } }],
  };
  const s = stubHttp(() => tfReply(JSON.stringify(compromised)));
  const logs: string[] = [];
  await radarPass({ convex: cv.convex, log: (l) => void logs.push(l), http: s.http, nebiusKey: "k".repeat(40), now: () => RECEIVED_AT });
  // The worker's embed pass runs next in the same minute; a co-sign queues no player here (Convex does the queueing).
  await embedPass({ convex: cv.convex, log: (l) => void logs.push(l), http: s.http, sleep: async () => {} });

  expect(cv.records).toHaveLength(1);
  const { outcome } = cv.records[0]!;
  expect(outcome.kind).toBe("saved");
  const release = (outcome as Extract<typeof outcome, { kind: "saved" }>).release;
  expect(release).toMatchObject({ artist: "[Artist Name]", title: "[Song Title]" });
  expect(release).not.toHaveProperty("label");
  for (const k of ["status", "approve", "sendTo", "open", "tools"]) {
    expect(release).not.toHaveProperty(k);
    expect(outcome).not.toHaveProperty(k);
  }
  expect(Object.keys(outcome).sort()).toEqual(["kind", "release"]);
  expect(JSON.stringify(outcome)).not.toMatch(/evil|https?:|@|pkg-/);

  expect(s.hosts()).toEqual(["api.tokenfactory.nebius.com"]);
  expect(cv.calls).toEqual(["pending", "record", "embedsWanted"]);
  expect(cv.results).toEqual([]);
  for (const l of logs) expect(l).not.toMatch(/evil|http|@|Artist|Song/);
});
