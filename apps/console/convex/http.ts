import { buildPackageDraft } from "@aircheck/core";
import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { MIN_TOKEN_LENGTH, pickInput, tokenMatches } from "./agentSubmit";

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const privateTerms = () =>
  (process.env.AIRCHECK_PRIVATE_TERMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Hard Rule 1: the draft is rebuilt and validated here, so nothing the agent sends can set status,
// workspace or fingerprint. The only function this route may call is internal.packages.submit.
const submitPackage = httpAction(async (ctx, req) => {
  const expected = process.env.AGENT_SUBMIT_TOKEN;
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return json(503, {});
  if (!tokenMatches(req.headers.get("authorization"), expected)) return json(401, {});
  const input = pickInput(await req.json().catch(() => null));
  if (!input) return json(400, { problems: ["body must be the seven package fields"] });
  const built = buildPackageDraft(input, { privateTerms: privateTerms() });
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
