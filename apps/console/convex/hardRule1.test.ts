// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { draftRunFor, goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import http from "./http";
import schema from "./schema";

// Hard Rule 1: no model output reaches publish. Every public write is listed here by name; HTTP actions
// are public by nature, so any httpAction export counts too (the one allowed is the agent route, pinned below).
// Convex marks registered functions with isPublic / isInternal / isMutation / isAction.
type Registered = { isPublic?: boolean; isInternal?: boolean; isMutation?: boolean; isAction?: boolean; isHttp?: boolean };

test("the public writes are exactly the allowlist", async () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./_generated/**"]);
  const exposed: string[] = [];
  const internal: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    const mod = (await load()) as Record<string, unknown>;
    for (const [name, fn] of Object.entries(mod)) {
      const f = fn as Registered;
      if (typeof fn !== "function" || !(f.isMutation || f.isAction || f.isHttp)) continue;
      const id = `${path.slice(2, -3)}.${name}`;
      (f.isPublic || f.isHttp ? exposed : internal).push(id);
    }
  }
  expect(exposed.sort()).toEqual(
    [
      "chat.send", "packages.decide", "relay.activity", "relay.events", "relay.finished", "relay.started", "relay.status", "runs.requestStop", "tracklist.draft",
      // Plan 5: the cover (signed-in human), the media and publisher services (each with its own token), Mixcloud status.
      "packages.setCover", "packages.coverUploadUrl",
      // I2: a signed-in real human settles a finished upload (reopen for review, or confirm it is on Mixcloud).
      "packages.reopen", "packages.confirmPosted",
      // Plan 5c: a signed-in real human edits the description before approval (re-fingerprints; never approves).
      "packages.editDescription",
      // R7: a signed-in real human fixes the tracks before approval (re-fingerprints; never approves).
      "packages.editTracklist",
      // Plan 5c Task 4: a live show's description. A signed-in human proposes and approves; the publisher claims and records.
      "descriptionUpdates.propose", "descriptionUpdates.approve", "descriptionUpdates.claim", "descriptionUpdates.record",
      "media.attached", "media.waiting",
      "publisher.claim", "publisher.result", "publisher.reconcile", "publisher.setMixcloud", "publisher.unclaim",
      "mixcloud.connected", "mixcloud.disconnected",
      // Plan 6: the ingest service (its own token) and the Episodes page (a signed-in real human). None can decide.
      "ingest.upsert", "ingest.setFetch", "ingest.requestDraft", "ingest.sourceStatus",
      // I3: removes episode rows for dates gone from every source; never one with a package or a rerun mark.
      "ingest.prune",
      "episodes.answer", "episodes.markRerun", "episodes.unmarkRerun",
      // Plan 6 Task 3: Connect Google / Connect Dropbox record state and an account label only (a signed-in real human).
      "episodes.sourceConnected", "episodes.sourceDisconnected",
      // Plan 6b (decision 017): Tarik's fixes for a backlog show, a signed-in real human only; never a source write.
      "corrections.setTracklist", "corrections.pick", "corrections.setHours", "corrections.useFolderDate", "corrections.clear",
      "corrections.place", "corrections.unplace",
      // Plan 6b: the ingest service (its own token) reports the names it could not date.
      "ingest.reportUnplaced",
      // Add a 2025 show: a signed-in real human adds or removes a 2025 Friday for the scanner; never a source write.
      "episodes.addShowDate", "episodes.removeShowDate",
      // R9: "Try again" on a draft-failed show records a retry time only (a signed-in real human); it queues nothing.
      "episodes.retryDraft",
      // Plan 8: the console's inbound route (INBOX_TOKEN) stores a cleaned email; the ingest worker (INGEST_TOKEN) records
      // what it read and a Bandcamp player id; a signed-in human moves records. None can reach a package (Hard Rule 1).
      "radar.received", "radar.record", "radar.embedResult",
      "radar.setStatus", "radar.edit", "radar.setEmbargo", "radar.retry", "radar.retryEmbed", "radar.pastePlayer", "draftNow.draftNow",
      // Plan 8 Task 6b: a signed-in human (the demo actor on demo rows) stars a release; it changes nothing else.
      "radar.setFavorite",
      // Plan 7: a signed-in human (the demo actor in the demo workspace) starts and steers research. Research writes only
      // research rows and queues research runs; none can reach a package or the publisher.
      "research.startShowNotes", "research.startVerify", "research.startDeepDive", "research.takeOver", "research.resume",
      "research.regenerate", "research.editEntry", "research.setPrivate", "research.setSuppliedNote", "research.retarget",
      // Listening-queue brief B: the catch-up script (INBOX_TOKEN, not a human) repairs artist, title and label from the
      // same kept email and re-queues a Bandcamp page fetch. It reaches no package (Hard Rule 1).
      "radar.reparse",
    ].sort(),
  );
  expect(internal.sort()).toEqual(
    [
      "episodes.agentMarkRerun", "packages.attachAudio", "packages.claimForPublish", "packages.recordResult", "packages.revise", "packages.submit", "scripted.step", "seed.seedDemo",
      // Plan 7: the agent's research route, its search counter, and the hook relay.finished schedules for research runs.
      "research.submitEntry", "research.countSearch", "research.onRunFinished",
      // Oct 29 prefetch: the bridge gives back failed searches and reports Tavily credits (search usage rows only).
      "research.searchDone",
      // Plan 7 Task 5: the Thursday/Friday cron's verify start, and the play-history lookup with its one save.
      "research.scheduledVerify", "research.playContext", "research.savePlayContext",
    ].sort(),
  );
});

// The chat/run/relay code sits next to the publish path, so it must not touch it: no publish or decide
// function by name, no calls into packages.ts, and the packages table is only ever read (relay.events reads it
// for the run's packageId). This is a source-text check: it cannot see a call built from a computed string.
const RUN_FILES = ["relay", "chat", "tracklist", "scripted", "scriptedEvents", "demoLimits", "sandbox", "enqueue", "applyEvents", "runs", "runDefaults", "research"];
const src = (name: string) => readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");

test("run, chat and relay code never reach packages.decide or the publish functions", () => {
  for (const name of RUN_FILES) {
    const text = src(name);
    for (const banned of ["packages.decide", "claimForPublish", "recordResult", "attachAudio", "internal.packages", "api.packages", "gateFor", "convexPackageStore", "ApprovalGate", "descriptionUpdates"]) {
      expect(text, `${name}.ts mentions ${banned}`).not.toContain(banned);
    }
    expect(text, `${name}.ts imports packages`).not.toMatch(/from "\.\/packages/);
  }
});

test("run, chat and relay code import only actorOf, workspaceOf and Workspace from gate", () => {
  for (const name of RUN_FILES) {
    const names = [...src(name).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"\.\/gate"/g)]
      .flatMap((m) => m[1]!.split(",").map((x) => x.trim().replace(/^type\s+/, "")).filter(Boolean));
    expect(names.filter((n) => !["actorOf", "workspaceOf", "Workspace"].includes(n)), `${name}.ts gate imports`).toEqual([]);
    expect(src(name), `${name}.ts has a non-braced gate import`).not.toMatch(/from\s+"\.\/gate"[\s\S]*?^import\s+\*/m);
  }
});

test("run, chat and relay code never write the packages table", () => {
  for (const name of RUN_FILES) {
    const text = src(name);
    for (const m of text.matchAll(/"packages"/g)) {
      expect(text.slice(Math.max(0, m.index! - 15), m.index! + 10), `${name}.ts uses "packages" outside ctx.db.query`).toMatch(/ctx\.db\.query\("packages"/);
    }
    expect(text).not.toMatch(/(?:patch|insert|replace|delete)\("packages"/);
  }
});

test("the only HTTP routes are the agent's submit, revise, read-only get, rerun mark, read-only radar, research, search usage, read-only prefetch plan and search done", () => {
  expect(http.getRoutes().map(([path, method]) => [path, method]).sort()).toEqual([
    ["/agent/episodes/rerun", "POST"], ["/agent/packages", "POST"], ["/agent/packages/get", "POST"], ["/agent/packages/revise", "POST"], ["/agent/radar", "POST"],
    ["/agent/research", "POST"], ["/agent/research-prefetch", "POST"], ["/agent/search-done", "POST"], ["/agent/search-usage", "POST"],
  ]);
});

test("the agent routes reach only internal.packages.submit, internal.packages.revise, internal.packages.agentGet, internal.episodes.agentMarkRerun, internal.radar.agentList, internal.research.submitEntry, internal.research.countSearch, internal.research.prefetchPlan and internal.research.searchDone", () => {
  const allowed = ["internal.packages.submit", "internal.packages.revise", "internal.packages.agentGet", "internal.episodes.agentMarkRerun", "internal.radar.agentList", "internal.research.submitEntry", "internal.research.countSearch", "internal.research.prefetchPlan", "internal.research.searchDone"];
  for (const file of ["./http.ts", "./agentSubmit.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const refs = new Set(src.match(/\b(?:internal|api)\.\w+\.\w+/g) ?? []);
    expect([...refs].filter((r) => !allowed.includes(r))).toEqual([]);
  }
  for (const ref of allowed) expect(readFileSync(new URL("./http.ts", import.meta.url), "utf8")).toContain(ref);
});

// Plan 8 (Review Focus 2): the agent's radar view runs one internal query and nothing else, so an email can never trigger
// a write through it (Hard Rule 5), and radar.ts never touches a package.
test("the /agent/radar handler can only run internal.radar.agentList, a query", () => {
  const text = src("http");
  const handler = text.slice(text.indexOf("const radarView = httpAction("), text.indexOf("\n});", text.indexOf("const radarView = httpAction(")));
  expect([...handler.matchAll(/ctx\.(\w+)\(([^,)]*)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(["runQuery internal.radar.agentList"]);
  expect(text).toContain(`path: "/agent/radar", method: "POST", handler: radarView`);
  const radar = src("radar");
  expect(radar).toMatch(/export const agentList = internalQuery\(/);
  for (const banned of ["packages.decide", "gateFor", "ApprovalGate", "internal.packages", "api.packages", "descriptionUpdates", "runMutation", "runAction", "scheduler", "fetch("]) {
    expect(radar, `radar.ts mentions ${banned}`).not.toContain(banned);
  }
  expect(radar).not.toMatch(/(?:patch|insert|replace|delete)\("(?:packages|runs|messages|conversations)"/);
});

// Plan 5c: the agent's revise reaches the gate only through revise (which never approves), and only for a package in
// the token's own workspace; the human edit checks the signed-in actor and workspace before the gate.
const fnBody = (text: string, decl: string) => {
  const body = text.slice(text.indexOf(decl));
  return body.slice(0, body.indexOf("\n});"));
};

// Plan 7 (Hard Rule 1): each research route runs exactly one internal mutation, its own, through agentRequest (so the
// ingest and inbox tokens are refused, R11). research.ts never touches a package or a description update.
test("the research routes each run one ctx.runMutation to their own function, and research.ts stays off the publish path", () => {
  const text = src("http");
  for (const [handler, ref, path, run] of [
    ["submitResearch", "internal.research.submitEntry", "/agent/research", "runMutation"],
    ["searchUsage", "internal.research.countSearch", "/agent/search-usage", "runMutation"],
    ["searchDone", "internal.research.searchDone", "/agent/search-done", "runMutation"],
    // Oct 29 prefetch: read-only, a query.
    ["researchPrefetch", "internal.research.prefetchPlan", "/agent/research-prefetch", "runQuery"],
  ] as const) {
    const body = fnBody(text, `const ${handler} = httpAction(`);
    expect([...body.matchAll(/ctx\.(\w+)\(([^,)]*)/g)].map((m) => `${m[1]} ${m[2]}`), handler).toEqual([`${run} ${ref}`]);
    expect(body, handler).toMatch(/await agentRequest\(req(, RESEARCH_BODY_BYTES)?\)/);
    expect(text).toContain(`path: "${path}", method: "POST", handler: ${handler}`);
  }
  const research = src("research");
  for (const banned of ["packages", "descriptionUpdates", "gateFor", "ApprovalGate", "publisher", "runAction", "fetch("]) expect(research, `research.ts mentions ${banned}`).not.toContain(banned);
  for (const name of ["submitEntry", "countSearch", "searchDone", "onRunFinished", "scheduledVerify", "savePlayContext"]) expect(research).toMatch(new RegExp(`export const ${name} = internalMutation\\(`));
  expect(research).toMatch(/export const prefetchPlan = internalQuery\(/);
  // Plan 7 Task 5: the one network use is play history, through core's lastPlayed (Hard Rule 3 is checked there).
  expect(research).toMatch(/export const playContext = internalAction\(/);
  expect([...research.matchAll(/\bfetch\b/g)]).toHaveLength(research.match(/lastPlayed\(fetch, /g)?.length ?? -1);
  expect(research.match(/lastPlayed\(fetch, /g)).toHaveLength(1);
  // No import cycle: ingest.ts reads research.ts (Air Check notes for a draft), so research.ts and radar.ts never import ingest.ts.
  for (const name of ["research", "radar"]) expect(src(name), `${name}.ts imports ingest`).not.toMatch(/from "\.\/ingest"/);
});

test("packages.revise (the agent's) calls only gateFor(ctx).revise, after the workspace check", () => {
  const fn = fnBody(src("packages"), "export const revise = internalMutation(");
  expect([...fn.matchAll(/gateFor\(ctx\)\.(\w+)/g)].map((m) => m[1])).toEqual(["revise"]);
  const workspaceCheck = fn.indexOf("cur.draft.workspace !== workspace");
  expect(workspaceCheck).toBeGreaterThan(0);
  expect(workspaceCheck).toBeLessThan(fn.indexOf("gateFor(ctx).revise("));
  expect(fn).not.toMatch(/\bdecide\b|decidedBy|"approved"/);
});

test("packages.revise proposes a live show's update only as the agent, and only after the workspace check", () => {
  const fn = fnBody(src("packages"), "export const revise = internalMutation(");
  expect([...fn.matchAll(/proposeUpdate\(([^)]*)\)/g)].map((m) => m[1])).toEqual([`ctx, doc!, description, descriptionSources ?? [], "agent"`]);
  expect(fn.indexOf("cur.draft.workspace !== workspace")).toBeLessThan(fn.indexOf("proposeUpdate("));
});

// Plan 5c Task 4: who can move a description update where. Source pins on descriptionUpdates.ts.
test("descriptionUpdates: proposals are only ever inserted as proposed; only approve makes one approved, after the human and fingerprint checks", () => {
  const text = src("descriptionUpdates");
  expect([...text.matchAll(/\.insert\(\s*"(\w+)"/g)].map((m) => m[1])).toEqual(["descriptionUpdates"]);
  expect(text.match(/\.insert\(/g)).toHaveLength(1);
  expect(fnBody(text, "export async function proposeUpdate(")).toMatch(/status: "proposed"/);
  // Every write that sets approved: approve (from proposed), or a push that ended without an answer (from pushing).
  const approvedWrites = [...text.matchAll(/status: "approved"/g)].length;
  expect(approvedWrites).toBe(3);
  const approve = fnBody(text, "export const approve = mutation(");
  const write = approve.indexOf(`status: "approved"`);
  for (const check of [`actor?.kind !== "human"`, `workspaceOf(actor) !== "real"`, `u.status !== "proposed"`, "u.fingerprint !== fingerprint"]) {
    expect(approve.indexOf(check), check).toBeGreaterThan(0);
    expect(approve.indexOf(check), check).toBeLessThan(write);
  }
  const record = fnBody(text, "export const record = mutation(");
  expect(record.indexOf(`u?.status !== "pushing"`)).toBeGreaterThan(0);
  expect(record.indexOf(`u?.status !== "pushing"`)).toBeLessThan(record.indexOf(`status: "approved"`));
  expect(fnBody(text, "async function retryLater(")).toMatch(/status: "approved"/);
  expect(text.match(/retryLater\(ctx, u\b/g)).toHaveLength(2); // record (from pushing) and requeueStuckUpdates (by_status pushing)
  // The publisher's functions check its token first, and claim takes only approved rows.
  for (const name of ["claim", "record"]) expect(fnBody(text, `export const ${name} = mutation(`)).toMatch(/handler: async \(ctx, \{ token[^}]*\}\) => \{\n\s+requirePublisher\(token\);/);
  const claim = fnBody(text, "export const claim = mutation(");
  // Plan 8: approved rows only; one an embargo now holds is skipped, never handed out.
  expect(claim).toMatch(/withIndex\("by_status", \(q\) => q\.eq\("status", "approved"\)\)\.collect\(\)/);
  expect([...claim.matchAll(/status: "(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["failed", "pushing"]);
  // The update path never touches the package row (R10) or the gate.
  for (const banned of ["gateFor", "ApprovalGate", "convexPackageStore", "compareAndSwap", `patch(pkg`, `"packages", `]) expect(text, banned).not.toContain(banned);
});

test("the publisher claims only approved updates: every other status is never handed out", async () => {
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64) } });
  await t.run(async (ctx) => {
    await ctx.db.insert("packages", { packageId: draft.id, workspace: "real", status: "succeeded", draft, result: { url: "https://www.mixcloud.com/rhythmlab/x/" } });
    for (const status of ["proposed", "pushed", "failed"] as const)
      await ctx.db.insert("descriptionUpdates", { packageId: draft.id, description: status, status, proposedBy: "agent", fingerprint: "f", attempts: 0 });
  });
  expect(await t.mutation(api.descriptionUpdates.claim, { token: "p".repeat(48) })).toBeNull();
  expect((await t.run((ctx) => ctx.db.query("descriptionUpdates").collect())).map((u) => u.status).sort()).toEqual(["failed", "proposed", "pushed"]);
});

test("packages.editDescription checks the signed-in actor and the workspace before the gate", () => {
  const fn = fnBody(src("packages"), "export const editDescription = mutation(");
  const gate = fn.indexOf("gateFor(ctx).editDescription(");
  expect(gate).toBeGreaterThan(0);
  expect([...fn.matchAll(/gateFor\(ctx\)\.(\w+)/g)].map((m) => m[1])).toEqual(["editDescription"]);
  for (const check of ["await staffOn(ctx, packageId)", `workspaceOf(actor) !== "real"`]) {
    expect(fn.indexOf(check), check).toBeGreaterThan(0);
    expect(fn.indexOf(check), check).toBeLessThan(gate);
  }
});

test("packages.editTracklist checks the signed-in actor and the workspace before the gate", () => {
  const fn = fnBody(src("packages"), "export const editTracklist = mutation(");
  const gate = fn.indexOf("gateFor(ctx).editTracklist(");
  expect(gate).toBeGreaterThan(0);
  expect([...fn.matchAll(/gateFor\(ctx\)\.(\w+)/g)].map((m) => m[1])).toEqual(["editTracklist"]);
  for (const check of ["await staffOn(ctx, packageId)", `workspaceOf(actor) !== "real"`]) {
    expect(fn.indexOf(check), check).toBeGreaterThan(0);
    expect(fn.indexOf(check), check).toBeLessThan(gate);
  }
});

test("the agent route files import only what they should and make one ctx.run call per route", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const httpSrc = read("./http.ts");
  const rel = [...httpSrc.matchAll(/from "(\.[^"]*)"/g)].map((m) => m[1]).sort();
  expect(rel).toEqual(["./_generated/api", "./_generated/server", "./agentSubmit"]);
  const agent = read("./agentSubmit.ts");
  expect(agent).not.toMatch(/_generated/);
  expect(agent).not.toMatch(/\bctx\b/);
  expect(httpSrc.match(/ctx\.run\w*/g)).toEqual(["ctx.runMutation", "ctx.runMutation", "ctx.runQuery", "ctx.runMutation", "ctx.runQuery", "ctx.runMutation", "ctx.runMutation", "ctx.runQuery", "ctx.runMutation"]);
});

// The agent reads a package before it revises one. Read-only: an internal query (Convex gives it no writer), and its
// source never writes, never reaches the gate, and never returns the cover, audio, receipt URL or who decided.
test("packages.agentGet is a read-only internal query that returns only the rewrite fields", async () => {
  const mod = (await import("./packages")) as unknown as Record<string, { isQuery?: boolean; isInternal?: boolean }>;
  expect(mod.agentGet?.isQuery && mod.agentGet.isInternal).toBe(true);
  expect(src("packages")).toContain("export const agentGet = internalQuery(");
  const fn = fnBody(src("packages"), "export const agentGet = internalQuery(");
  expect(fn).not.toMatch(/\b(?:insert|patch|replace|delete|gateFor|proposeUpdate|runMutation|scheduler)\b/);
  expect(fn).not.toMatch(/coverStorageId|audio|fingerprint|decidedBy|result/);
  const route = fnBody(readFileSync(new URL("./http.ts", import.meta.url), "utf8"), "const getPackage = httpAction(");
  expect(route.match(/ctx\.\w+/g)).toEqual(["ctx.runQuery"]);
});

// Plan 5: the media and publisher services. Neither can decide; the publisher reaches packages only through the
// gate's claimForPublish and recordResult (and reads them); Mixcloud status code never touches packages.
const SERVICE_FILES = ["media", "publisher", "mixcloud"];

test("media and mixcloud code never touch description updates; publisher only requeues stuck ones", () => {
  for (const name of ["media", "mixcloud"]) expect(src(name), name).not.toContain("descriptionUpdates");
  expect([...src("publisher").matchAll(/\b(requeueStuckUpdates|proposeUpdate|descriptionUpdates)\b/g)].map((m) => m[1]).sort()).toEqual(["descriptionUpdates", "requeueStuckUpdates", "requeueStuckUpdates"]);
});

test("media, publisher and mixcloud code never call decide", () => {
  for (const name of SERVICE_FILES) {
    const text = src(name);
    expect(text, `${name}.ts mentions decide`).not.toMatch(/\bdecide\b/);
    for (const banned of ["internal.packages", "api.packages", "ApprovalGate"]) expect(text, `${name}.ts mentions ${banned}`).not.toContain(banned);
  }
});

test("the publisher reaches packages only through claimForPublish, recordResult and unclaim", () => {
  const text = src("publisher");
  expect([...new Set([...text.matchAll(/gateFor\(ctx\)\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(["claimForPublish", "recordResult", "unclaim"]);
  expect(text.match(/gateFor\(/g)).toHaveLength(text.match(/gateFor\(ctx\)\.(?:claimForPublish|recordResult|unclaim)\(/g)!.length);
  // unclaim is only ever the invalid-token case (R23): Mixcloud refused the key before taking any audio.
  expect([...text.matchAll(/\.unclaim\(([^)]*)\)/g)].map((m) => m[1])).toEqual([`packageId, "invalid_token"`]);
  for (const banned of ["convexPackageStore", "compareAndSwap", "attachAudio", "setCover"]) expect(text, `publisher.ts mentions ${banned}`).not.toContain(banned);
  // No direct writes at all: Mixcloud status goes through mixcloud.ts's writer.
  expect(text).not.toMatch(/\.(?:patch|insert|replace|delete)\(/);
});

test("media, publisher and mixcloud code never reopen or confirm a package", () => {
  for (const name of SERVICE_FILES) {
    for (const banned of ["reopen", "confirmPosted"]) expect(src(name), `${name}.ts mentions ${banned}`).not.toContain(banned);
  }
});

test("media and mixcloud code never claim or record a publish result", () => {
  for (const name of ["media", "mixcloud"]) {
    for (const banned of ["claimForPublish", "recordResult", "unclaim"]) expect(src(name), `${name}.ts mentions ${banned}`).not.toContain(banned);
  }
  expect(src("mixcloud")).not.toMatch(/"packages"|gateFor|convexPackageStore/);
});

// media.attached holds the one raw package write outside the gate (R3: swapping the agent's placeholder hour ids
// for the real filenames). Pin it so it can only ever touch a package still preparing audio, and only its draft.
test("media's only raw package write is preparing_audio -> { draft }, and it reaches the gate only through attachAudio", () => {
  const text = src("media");
  const cas = [...text.matchAll(/compareAndSwap\(([^)]*)\)/g)];
  expect(cas, "media.ts compareAndSwap calls").toHaveLength(1);
  expect(cas[0]![1]!.replace(/\s+/g, " ").trim()).toBe(`packageId, { status: "preparing_audio" }, { draft }`);
  for (const banned of [`"approved"`, `"publishing"`, ".patch(", ".replace(", "put("]) expect(text, `media.ts mentions ${banned}`).not.toContain(banned);
  expect([...text.matchAll(/\.insert\(\s*"(\w+)"/g)].map((m) => m[1])).toEqual(["audioIssues"]);
  expect(text.match(/\.insert\(/g)).toHaveLength(1);
  // The one delete clears the audioIssues set row by row.
  expect(text.match(/\.delete\(/g)).toHaveLength(1);
  expect(text).toMatch(/for \(const row of await ctx\.db\.query\("audioIssues"\)\.collect\(\)\) await ctx\.db\.delete\(row\._id\);/);
  expect([...text.matchAll(/from "(\.[^"]*)"/g)].map((m) => m[1]).sort()).toEqual(["./_generated/server", "./agentSubmit", "./gate", "./packageStore"]);
  expect([...new Set([...text.matchAll(/gateFor\(ctx\)\.(\w+)/g)].map((m) => m[1]))]).toEqual(["attachAudio"]);
  expect(text.match(/gateFor\(/g)).toHaveLength(text.match(/gateFor\(ctx\)\.attachAudio\(/g)!.length);
});

afterEach(() => vi.unstubAllEnvs());
const modules = import.meta.glob("./**/*.*s");

test("a package never approved through packages.decide cannot be claimed", async () => {
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  const args = { packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 1, mp3Bytes: 1 };
  await t.mutation(api.media.attached, { token: "m".repeat(48), ...args });
  await expect(t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: draft.id })).rejects.toThrow(/NOT_READY/);
  const doc = await t.run((ctx) => ctx.db.query("packages").first());
  expect(doc?.status).toBe("awaiting_review");
});

test("the relay's, the agent's and the ingest service's tokens are refused by every media and publisher function", async () => {
  const RELAY = "r".repeat(48);
  const AGENT = "a".repeat(48);
  vi.stubEnv("RELAY_TOKEN", RELAY);
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", "d".repeat(48));
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  vi.stubEnv("INGEST_TOKEN", "i".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  const cover = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const before = await t.run((ctx) => ctx.db.query("packages").collect());
  for (const token of [RELAY, AGENT, "d".repeat(48), "i".repeat(48)]) {
    const id = draft.id;
    const calls = [
      t.query(api.media.pending, { token }),
      t.mutation(api.media.attached, { token, packageId: id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 1, mp3Bytes: 1 }),
      t.mutation(api.media.waiting, { token, items: [] }),
      t.query(api.media.cleanup, { token }),
      t.query(api.publisher.queue, { token }),
      t.mutation(api.publisher.claim, { token, packageId: id }),
      t.mutation(api.publisher.result, { token, packageId: id, result: { status: "outcome_unknown" } }),
      t.mutation(api.publisher.reconcile, { token }),
      t.query(api.publisher.coverUrl, { token, storageId: cover }),
      t.mutation(api.publisher.setMixcloud, { token, state: "connected" }),
      t.mutation(api.publisher.unclaim, { token, packageId: id }),
      t.query(api.publisher.awaitingReview, { token }),
      t.query(api.publisher.researchReady, { token }),
      t.query(api.media.statuses, { token, packageIds: [id] }),
      t.mutation(api.descriptionUpdates.claim, { token }),
    ];
    for (const call of calls) await expect(call).rejects.toThrow(/UNAUTHORIZED/);
  }
  expect(await t.run((ctx) => ctx.db.query("packages").collect())).toEqual(before);
});

// I2: reopen and confirmPosted are human-only and never hand the publisher an approved package.
test("reopen never yields approved, and the service tokens, the demo login and no login cannot reopen or confirm", async () => {
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  await t.mutation(api.media.attached, { token: "m".repeat(48), packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 1, mp3Bytes: 1 });
  const staff = t.withIdentity({ subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true });
  const fp = (await t.run((ctx) => ctx.db.query("packages").first()))!.fingerprint!;
  await staff.mutation(api.packages.decide, { packageId: draft.id, fingerprint: fp, decision: "approve" });
  await t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: draft.id });
  await t.mutation(api.publisher.result, { token: "p".repeat(48), packageId: draft.id, result: { status: "outcome_unknown" } });
  // No login (how every service and the agent reach Convex) and the demo login are refused, whatever they send.
  for (const as of [t, t.withIdentity({ subject: "d1", role: "demo" })]) {
    expect(await as.mutation(api.packages.reopen, { packageId: draft.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await as.mutation(api.packages.confirmPosted, { packageId: draft.id, url: "https://www.mixcloud.com/x/y/" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  }
  // The functions take no token at all, so a service token cannot even be passed.
  await expect(t.mutation(api.packages.reopen, { packageId: draft.id, token: "p".repeat(48) } as never)).rejects.toThrow();
  const r = await staff.mutation(api.packages.reopen, { packageId: draft.id });
  expect(r.ok && r.record.status).toBe("awaiting_review");
  await expect(t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: draft.id })).rejects.toThrow(/NOT_READY/);
  expect((await t.run((ctx) => ctx.db.query("packages").first()))?.status).toBe("awaiting_review");
});

test("packages.reopen and packages.confirmPosted check the signed-in actor and the workspace before the gate", () => {
  const text = src("packages");
  for (const name of ["reopen", "confirmPosted"]) {
    const body = text.slice(text.indexOf(`export const ${name} = mutation(`));
    const end = body.indexOf("\n});");
    const fn = body.slice(0, end);
    const gate = fn.indexOf(`gateFor(ctx).${name}(`);
    expect(gate, name).toBeGreaterThan(0);
    for (const check of ["await staffOn(ctx, packageId)", `workspaceOf(actor) !== "real"`]) {
      expect(fn.indexOf(check), `${name}: ${check}`).toBeGreaterThan(0);
      expect(fn.indexOf(check), `${name}: ${check}`).toBeLessThan(gate);
    }
  }
  const staffOn = text.slice(text.indexOf("async function staffOn("), text.indexOf("\n}\n", text.indexOf("async function staffOn(")));
  expect(staffOn).toMatch(/await actorOf\(ctx\)/);
  expect(staffOn).toMatch(/workspaceOf\(actor\) !== "real"/);
});

test("reopening an audio failure goes to preparing_audio, never approved, and cannot be claimed", async () => {
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  const t = convexTest(schema, modules);
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  await t.mutation(api.media.attached, { token: "m".repeat(48), packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "c".repeat(64), hour1DurationSec: 1, mp3Bytes: 1 });
  const staff = t.withIdentity({ subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true });
  const fp = (await t.run((ctx) => ctx.db.query("packages").first()))!.fingerprint!;
  await staff.mutation(api.packages.decide, { packageId: draft.id, fingerprint: fp, decision: "approve" });
  await t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: draft.id });
  await t.mutation(api.publisher.result, { token: "p".repeat(48), packageId: draft.id, result: { status: "failed", error: "audio_missing" } });
  for (const as of [t, t.withIdentity({ subject: "d1", role: "demo" })])
    expect(await as.mutation(api.packages.reopen, { packageId: draft.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  const r = await staff.mutation(api.packages.reopen, { packageId: draft.id });
  expect(r.ok && r.record.status).toBe("preparing_audio");
  await expect(t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: draft.id })).rejects.toThrow(/NOT_READY/);
  // The old fingerprint cannot approve it either: there is no MP3 to approve until media rebuilds it.
  expect(await staff.mutation(api.packages.decide, { packageId: draft.id, fingerprint: fp, decision: "approve" })).toMatchObject({ ok: false, code: "NOT_READY" });
  expect((await t.run((ctx) => ctx.db.query("packages").first()))?.status).toBe("preparing_audio");
});

// Plan 6: the ingest service and the Episodes page sit beside the publish path and must never reach it (source pins).
// requestDraft only queues the same draft-package run the Tracklist page does: the agent drafts, Tarik approves.
test("ingest and episodes code never reach the gate, decide, publish or description updates, and only read packages", () => {
  for (const name of ["ingest", "episodes", "draftNow"]) {
    const text = src(name);
    for (const banned of ["decide", "claimForPublish", "recordResult", "attachAudio", "unclaim", "reopen", "confirmPosted", "gateFor", "ApprovalGate", "convexPackageStore", "compareAndSwap", "descriptionUpdates", "proposeUpdate", "scheduler"])
      expect(text, `${name}.ts mentions ${banned}`).not.toMatch(new RegExp(`\\b${banned}\\b`));
    for (const banned of ["internal.packages", "api.packages"]) expect(text, `${name}.ts mentions ${banned}`).not.toContain(banned);
    expect(text, `${name}.ts imports packages`).not.toMatch(/from "\.\/packages/);
    for (const m of text.matchAll(/"packages"/g))
      expect(text.slice(Math.max(0, m.index! - 15), m.index! + 10), `${name}.ts uses "packages" outside ctx.db.query`).toMatch(/ctx\.db\.query\("packages"/);
    expect(text).not.toMatch(/(?:patch|insert|replace|delete)\("packages"/);
    const gateNames = [...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"\.\/gate"/g)].flatMap((m) => m[1]!.split(",").map((x) => x.trim()).filter(Boolean));
    expect(gateNames.filter((n) => !["actorOf", "workspaceOf"].includes(n)), `${name}.ts gate imports`).toEqual([]);
  }
});

test("every ingest function checks INGEST_TOKEN first", () => {
  const text = src("ingest");
  const names = [...text.matchAll(/export const (\w+) = (?:query|mutation)\(/g)].map((m) => m[1]!);
  expect(names.sort()).toEqual(["list", "prune", "reportUnplaced", "requestDraft", "setFetch", "sourceStatus", "upsert"]);
  for (const name of names) expect(fnBody(text, `export const ${name} = `), name).toMatch(/handler: async \(ctx, \{ token[^}]*\}\) => \{\n\s+requireIngest\(token\);/);
  expect(text).not.toMatch(/\b(?:internalMutation|internalQuery|action|httpAction)\b/);
});

test("ingest.requestDraft and Draft now write only a draft-package run, through tracklist's queueDraft, in the real workspace", () => {
  // Oct 30: both go through draftNow.ts's draftIfReady; the ingest service keeps the pace, Tarik's Draft now skips it.
  const fn = fnBody(src("ingest"), "export const requestDraft = mutation(");
  expect(fn).toContain("draftIfReady(ctx, showDate, { pace: true })");
  expect(fn).not.toMatch(/queueDraft\(|\.(?:insert|patch|replace|delete)\(/);
  const ready = fnBody(src("draftNow"), "export async function draftIfReady(");
  expect(ready.match(/queueDraft\(/g)).toEqual(["queueDraft("]);
  expect(ready).toContain(`queueDraft(ctx, "real", `);
  expect(ready).not.toMatch(/\.(?:insert|patch|replace|delete)\(/);
  const now = fnBody(src("draftNow"), "export const draftNow = mutation(");
  expect(now).toMatch(/await requireRealHuman\(ctx\);/);
  expect(now).toContain("draftIfReady(ctx, showDate, { pace: false })");
  expect(now).not.toMatch(/\.(?:insert|patch|replace|delete)\(/);
  const helper = src("tracklist").slice(src("tracklist").indexOf("export function queueDraft("));
  expect(helper.slice(0, helper.indexOf("\n}\n"))).toMatch(/enqueueRun\(ctx, \{[^}]*kind: "draft-package"/);
});

// Review Focus 5 / Hard Rule 12: nothing on the way to Mixcloud reads an episode, so Paper notes cannot reach a public field.
test("the publish path never reads episodes or ingest code", () => {
  for (const name of ["publisher", "descriptionUpdates", "media", "mixcloud", "packages", "packageStore", "gate"])
    expect(src(name), name).not.toMatch(/"episodes"|\.\/(?:episodes|ingest)"|(?:api|internal)\.(?:episodes|ingest)\b/);
});
