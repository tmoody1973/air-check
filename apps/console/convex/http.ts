import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { MIN_TOKEN_LENGTH, pickInput, pickResearch, pickRevision, pickSearchUsage, privateTerms, readCapped, workspaceForToken } from "./agentSubmit";

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
// ponytail: byte % 36 has a slight bias; fine for a collision-avoiding id, not for secrets.
const demoIdSuffix = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => BASE36[b % 36]).join("");

/** The agent's token picks the workspace (real or demo); then the capped JSON body. A Response means refused. */
async function agentRequest(req: Request): Promise<{ workspace: "real" | "demo"; body: unknown } | Response> {
  const tokens = { real: process.env.AGENT_SUBMIT_TOKEN, demo: process.env.DEMO_AGENT_SUBMIT_TOKEN };
  const usable = (t: string | undefined) => !!t && t.length >= MIN_TOKEN_LENGTH;
  if ((!usable(tokens.real) && !usable(tokens.demo)) || (tokens.real === tokens.demo)) return json(503, {}); // equal = misconfigured
  const workspace = workspaceForToken(req.headers.get("authorization"), tokens);
  if (!workspace) return json(401, {});
  const text = await readCapped(req);
  if (text === null) return json(413, {});
  try {
    return { workspace, body: JSON.parse(text) };
  } catch {
    return { workspace, body: null }; // not JSON: the pick functions reject null
  }
}

// Hard Rule 1: the draft is built and validated in internal.packages.submit from the picked fields, so nothing the agent
// sends can set status, workspace or fingerprint. R9: its tracks are the draft request's; any tracklist the agent sends
// is ignored. The only function this route may call is internal.packages.submit.
const submitPackage = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const { workspace, body } = got;
  const input = pickInput(body);
  if (!input) return json(400, { problems: ["body must be the package fields: showDate, leads, tags, description, hour1Id, hour2Id"] });
  // Demo visitors may draft the same date many times (and the seeded demo-10-2-26 exists): each demo id is unique.
  const agent = { input, workspace, ...(workspace === "demo" && { idSuffix: demoIdSuffix() }) };
  try {
    const rec = await ctx.runMutation(internal.packages.submit, { agent });
    return json(201, { packageId: rec.draft.id, status: rec.status });
  } catch (e) {
    const data = e instanceof ConvexError ? (e.data as { code?: string; message?: string; problems?: string[] }) : {};
    if (data.code === "ALREADY_EXISTS") return json(409, { error: "ALREADY_EXISTS" });
    // A plain problem (no draft request, a title artist not in the request's tracklist...): the bridge hands these
    // words to the agent so it can correct itself.
    if (data.code === "BAD_INPUT") return json(400, { problems: data.problems ?? [data.message ?? "bad input"] });
    throw e;
  }
});

// Hard Rule 1: the agent rewrites the description of a package awaiting review, in its token's workspace only. It goes
// back to review with a new fingerprint, so only a human's Approve of the new text publishes it. On a package already
// on Mixcloud it only proposes an update (201), which waits for a human's Approve update. The only function this route
// may call is internal.packages.revise.
const revisePackage = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const input = pickRevision(got.body);
  if (!input) return json(400, { problems: ["body must be packageId and description, with optional descriptionSources"] });
  const r = await ctx.runMutation(internal.packages.revise, { workspace: got.workspace, ...input });
  if (r.ok) return "updateId" in r ? json(201, { packageId: input.packageId, updateId: r.updateId, status: r.status }) : json(200, { packageId: input.packageId, status: r.status });
  if (r.code === "BAD_INPUT") return json(400, { problems: r.problems });
  return r.code === "NOT_FOUND" ? json(404, { error: "NOT_FOUND" }) : json(409, { error: r.message });
});

// Read-only: the agent reads a package in its token's workspace before it rewrites the description (it never saw the
// tracklist otherwise). The only function this route may call is internal.packages.agentGet, a query: it cannot write.
const getPackage = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const packageId = (got.body as { packageId?: unknown } | null)?.packageId;
  if (typeof packageId !== "string" || !packageId.trim()) return json(400, { problems: ["body must be packageId"] });
  const pkg = await ctx.runQuery(internal.packages.agentGet, { workspace: got.workspace, packageId });
  return pkg ? json(200, pkg) : json(404, { error: "NOT_FOUND" });
});

// Plan 6 (R7/R9): the agent records "<date> is a rerun of <date>", said in Chat. It stores a fact on the episode (that
// week is not drafted or fetched; Tarik can undo it on Episodes) and cannot reach a package. Hard Rule 9: the demo
// workspace has no episodes, so the demo token gets 404. The only function this route may call is
// internal.episodes.agentMarkRerun.
const markRerun = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const b = got.body as { showDate?: unknown; rerunOf?: unknown } | null;
  if (typeof b?.showDate !== "string" || typeof b.rerunOf !== "string") return json(400, { problems: ["body must be showDate and rerunOf, both yyyy-mm-dd"] });
  const r = await ctx.runMutation(internal.episodes.agentMarkRerun, { workspace: got.workspace, showDate: b.showDate, rerunOf: b.rerunOf });
  if (r.ok) return json(200, { showDate: b.showDate, rerunOf: b.rerunOf });
  return r.code === "NOT_FOUND" ? json(404, { error: "NOT_FOUND" }) : json(400, { problems: r.problems });
});

const RADAR_STATUSES = ["new", "considering", "played", "passed"] as const;
const RADAR_TABS = ["bandcamp", "cosign"] as const;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => list.includes(x as T);

// Plan 8 (Hard Rule 5, Review Focus 2): the agent reads release records, never an email. internal.radar.agentList picks
// the fields one by one (no links, player, senders or email text) and leaves active embargoes out. Read-only: the only
// function this route may call is internal.radar.agentList, a query.
const radarView = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const b = got.body ?? {};
  if (typeof b !== "object" || Array.isArray(b)) return json(400, { problems: ["body must be an object with optional status and tab"] });
  const { status, tab } = b as { status?: unknown; tab?: unknown };
  if (status !== undefined && !oneOf(RADAR_STATUSES, status)) return json(400, { problems: [`status must be one of ${RADAR_STATUSES.join(", ")}`] });
  if (tab !== undefined && !oneOf(RADAR_TABS, tab)) return json(400, { problems: [`tab must be one of ${RADAR_TABS.join(", ")}`] });
  const releases = await ctx.runQuery(internal.radar.agentList, { workspace: got.workspace, ...(status !== undefined && { status }), ...(tab !== undefined && { tab }) });
  return json(200, { releases });
});

// Plan 7 (Hard Rule 1, decision 011): the agent saves one research block, in its token's workspace only. It can write
// research rows and nothing else; every refusal is a plain sentence the bridge hands back (R8: they name only the key
// and the agent's own words). The only function this route may call is internal.research.submitEntry.
const submitResearch = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const picked = pickResearch(got.body);
  if ("problems" in picked) return json(400, { problems: picked.problems });
  const r = await ctx.runMutation(internal.research.submitEntry, { workspace: got.workspace, input: picked.input });
  if (r.ok) return json(200, { saved: r.saved, claims: r.claims, verify: r.verify, dropped: r.dropped });
  if (r.status === 404) return json(404, { error: "NOT_FOUND" });
  return r.status === 400 ? json(400, { problems: r.problems }) : json(409, { error: r.problems[0] });
});

// Plan 7: the bridge asks before each source_search. A query naming an active embargo is refused uncounted (R2); else
// one is added to today's count when under the cap. The only function this route may call is internal.research.countSearch.
const searchUsage = httpAction(async (ctx, req) => {
  const got = await agentRequest(req);
  if (got instanceof Response) return got;
  const picked = pickSearchUsage(got.body);
  if (!picked) return json(400, { problems: ["body must be query, with optional source web or apple_music"] });
  return json(200, await ctx.runMutation(internal.research.countSearch, { workspace: got.workspace, ...picked }));
});

const http = httpRouter();
http.route({ path: "/agent/packages", method: "POST", handler: submitPackage });
http.route({ path: "/agent/packages/revise", method: "POST", handler: revisePackage });
http.route({ path: "/agent/packages/get", method: "POST", handler: getPackage });
http.route({ path: "/agent/episodes/rerun", method: "POST", handler: markRerun });
http.route({ path: "/agent/radar", method: "POST", handler: radarView });
http.route({ path: "/agent/research", method: "POST", handler: submitResearch });
http.route({ path: "/agent/search-usage", method: "POST", handler: searchUsage });
export default http;
