import { buildPackageDraft } from "@aircheck/core";
import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { MIN_TOKEN_LENGTH, pickInput, readCapped, workspaceForToken } from "./agentSubmit";

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
// ponytail: byte % 36 has a slight bias; fine for a collision-avoiding id, not for secrets.
const demoIdSuffix = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => BASE36[b % 36]).join("");

const privateTerms = () =>
  (process.env.AIRCHECK_PRIVATE_TERMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Hard Rule 1: the draft is rebuilt and validated here, so nothing the agent sends can set status,
// workspace or fingerprint. The only function this route may call is internal.packages.submit.
const submitPackage = httpAction(async (ctx, req) => {
  const tokens = { real: process.env.AGENT_SUBMIT_TOKEN, demo: process.env.DEMO_AGENT_SUBMIT_TOKEN };
  const usable = (t: string | undefined) => !!t && t.length >= MIN_TOKEN_LENGTH;
  if ((!usable(tokens.real) && !usable(tokens.demo)) || (tokens.real === tokens.demo)) return json(503, {}); // equal = misconfigured
  const workspace = workspaceForToken(req.headers.get("authorization"), tokens);
  if (!workspace) return json(401, {});
  const text = await readCapped(req);
  if (text === null) return json(413, {});
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: pickInput rejects null below
  }
  const input = pickInput(body);
  if (!input) return json(400, { problems: ["body must be the seven package fields"] });
  // Demo visitors may draft the same date many times (and the seeded demo-10-2-26 exists): each demo id is unique.
  const built = buildPackageDraft(input, { privateTerms: privateTerms(), workspace, ...(workspace === "demo" && { idSuffix: demoIdSuffix() }) });
  if (!built.ok) return json(400, { problems: built.problems });
  try {
    const rec = await ctx.runMutation(internal.packages.submit, { draft: built.draft });
    return json(201, { packageId: built.draft.id, status: rec.status });
  } catch (e) {
    if (e instanceof ConvexError && (e.data as { code?: string }).code === "ALREADY_EXISTS") return json(409, { error: "ALREADY_EXISTS" });
    throw e;
  }
});

const http = httpRouter();
http.route({ path: "/agent/packages", method: "POST", handler: submitPackage });
export default http;
