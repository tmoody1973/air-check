import { DESCRIPTION_SKILL_TEXT } from "@aircheck/core";
import { describe, expect, it } from "vitest";
import { episodeMarkRerunTool, packageGetTool, packageReviseTool, packageSubmitTool } from "../src/aircheckTools.js";

const token = "t".repeat(40);
const input = {
  showDate: "2026-10-02",
  tracklistText: "Hour 1\n1. A - B",
  leads: ["A"],
  tags: ["soul"],
  description: "desc",
  hour1Id: "h1",
  hour2Id: "h2",
};

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const textOf = (r: { content: unknown }) => (r.content as { text: string }[]).map((c) => c.text).join("\n");

describe("package_submit", () => {
  it("describes the seven fields (plus optional sources) in its schema", () => {
    const { tool } = packageSubmitTool({ siteUrl: "https://x.convex.site", token, fetch: stub(201, {}).fetch });
    expect(tool.name).toBe("package_submit");
    expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual([...Object.keys(input), "descriptionSources"].sort());
  });

  it("R9: tracklistText is optional and says Air Check fills the tracklist from the draft request", () => {
    const { tool } = packageSubmitTool({ siteUrl: "https://x.convex.site", token, fetch: stub(201, {}).fetch });
    expect(tool.inputSchema.required).not.toContain("tracklistText");
    expect(JSON.stringify(tool.inputSchema.properties?.tracklistText)).toMatch(/Air Check fills the tracklist from the draft request/);
  });

  it("sends only the seven fields with the bearer token", async () => {
    const s = stub(201, { packageId: "pkg-10-2-26", status: "preparing_audio" });
    const { call } = packageSubmitTool({ siteUrl: "https://x.convex.site/", token, fetch: s.fetch });
    await call({ ...input, status: "approved", workspace: "demo" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe("https://x.convex.site/agent/packages");
    expect(s.calls[0]!.init.method).toBe("POST");
    expect(new Headers(s.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual(input);
  });

  it("201: says preparing audio and never claims approval", async () => {
    const { call } = packageSubmitTool({
      siteUrl: "https://x.convex.site",
      token,
      fetch: stub(201, { packageId: "pkg-10-2-26", status: "preparing_audio" }).fetch,
    });
    const r = await call(input);
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("pkg-10-2-26");
    expect(textOf(r)).toContain("preparing audio");
    expect(textOf(r)).not.toMatch(/approved/i);
  });

  it("400: lists the problems", async () => {
    const { call } = packageSubmitTool({
      siteUrl: "https://x.convex.site",
      token,
      fetch: stub(400, { problems: ["tags: too few", "hour1Id is empty"] }).fetch,
    });
    const r = await call(input);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("tags: too few");
    expect(textOf(r)).toContain("hour1Id is empty");
  });

  it("409: says already submitted", async () => {
    const { call } = packageSubmitTool({
      siteUrl: "https://x.convex.site",
      token,
      fetch: stub(409, { error: "ALREADY_EXISTS" }).fetch,
    });
    expect(textOf(await call(input))).toMatch(/already submitted/i);
  });

  it.each([401, 503])("%i: says submit is not configured without echoing the token", async (status) => {
    const { call } = packageSubmitTool({ siteUrl: "https://x.convex.site", token, fetch: stub(status, {}).fetch });
    const r = await call(input);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("submit is not configured");
    expect(textOf(r)).not.toContain(token);
  });

  it("network failure: an error result, not a throw", async () => {
    const fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const r = await packageSubmitTool({ siteUrl: "https://x.convex.site", token, fetch }).call(input);
    expect(r.isError).toBe(true);
    expect(textOf(r)).not.toMatch(/approved/i);
  });
});

// Plan 5c: the agent rewrites a description. It drafts, never approves (Hard Rule 1): the package goes back to review.
describe("package_revise", () => {
  const rev = { packageId: "pkg-10-2-26", description: "Warm, patient soul.", descriptionSources: [{ claim: "c", source: "s" }] };
  const tool = (status: number, body: unknown) => {
    const s = stub(status, body);
    return { s, ...packageReviseTool({ siteUrl: "https://x.convex.site/", token, fetch: s.fetch }) };
  };

  it("takes the package id, the description and optional sources", () => {
    const { tool: t } = tool(200, {});
    expect(t.name).toBe("package_revise");
    expect(Object.keys(t.inputSchema.properties ?? {}).sort()).toEqual(["description", "descriptionSources", "packageId"]);
    expect(t.inputSchema.required).toEqual(["packageId", "description"]);
    expect(t.description).not.toMatch(/approve/i);
  });

  it("sends only those fields with the bearer token to the revise route", async () => {
    const { s, call } = tool(200, { packageId: "pkg-10-2-26", status: "awaiting_review" });
    await call({ ...rev, status: "approved", workspace: "demo", fingerprint: "x" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe("https://x.convex.site/agent/packages/revise");
    expect(s.calls[0]!.init.method).toBe("POST");
    expect(new Headers(s.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual(rev);
  });

  it("200: back in review for a person, and never claims approval", async () => {
    const r = await tool(200, { packageId: "pkg-10-2-26", status: "awaiting_review" }).call(rev);
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("pkg-10-2-26");
    expect(textOf(r)).toMatch(/review/);
    expect(textOf(r)).not.toMatch(/approved/i);
  });

  // Plan 5c Task 4: on a show already on Mixcloud the route only proposes an update; a person must approve it.
  it("201: an update proposed for the live show, waiting for a person; never says it changed on Mixcloud", async () => {
    const r = await tool(201, { packageId: "pkg-10-2-26", updateId: "u1", status: "proposed" }).call(rev);
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("pkg-10-2-26");
    expect(textOf(r)).toMatch(/proposed/i);
    expect(textOf(r)).toMatch(/console/);
    expect(textOf(r)).not.toMatch(/\bupdated\b|\bchanged\b|approved/i);
  });

  it("the tool says it also proposes updates for published shows", () => {
    expect(tool(200, {}).tool.description).toMatch(/already on Mixcloud/);
  });

  it("400 lists the problems; 404 says no such package; 409 relays the plain reason", async () => {
    const bad = await tool(400, { problems: ["description has a time-relative phrase: \"today\""] }).call(rev);
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("time-relative phrase");
    const missing = await tool(404, { error: "NOT_FOUND" }).call(rev);
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/no package pkg-10-2-26/i);
    const pub = await tool(409, { error: "already published — propose an update instead" }).call(rev);
    expect(pub.isError).toBe(true);
    expect(textOf(pub)).toContain("already published — propose an update instead");
  });

  it.each([401, 503])("%i: not configured, without echoing the token", async (status) => {
    const r = await tool(status, {}).call(rev);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/not configured/);
    expect(textOf(r)).not.toContain(token);
  });

  it("network failure: an error result, not a throw", async () => {
    const fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const r = await packageReviseTool({ siteUrl: "https://x.convex.site", token, fetch }).call(rev);
    expect(r.isError).toBe(true);
    expect(textOf(r)).not.toMatch(/approved/i);
  });
});

// Final-review fix: the chat agent reads a package (tracklist, current description) before it revises it. Read-only.
describe("package_get", () => {
  const pkg = { packageId: "pkg-10-2-26", showDate: "2026-10-02", status: "awaiting_review", title: "T", tags: ["Soul"], tracklistText: "Hour 1\nA - B", description: "d" };
  const tool = (status: number, body: unknown) => {
    const s = stub(status, body);
    return { s, ...packageGetTool({ siteUrl: "https://x.convex.site/", token, fetch: s.fetch }) };
  };

  it("takes only the package id, says it is read-only, and never mentions approve", () => {
    const { tool: t } = tool(200, pkg);
    expect(t.name).toBe("package_get");
    expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(["packageId"]);
    expect(t.inputSchema.required).toEqual(["packageId"]);
    expect(t.description).toMatch(/read-only/i);
    expect(t.description).not.toMatch(/approv/i);
  });

  it("sends only the package id with the bearer token to the get route", async () => {
    const { s, call } = tool(200, pkg);
    await call({ packageId: "pkg-10-2-26", workspace: "real", status: "approved" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe("https://x.convex.site/agent/packages/get");
    expect(new Headers(s.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual({ packageId: "pkg-10-2-26" });
  });

  it("200: returns the package as JSON text plus the description guide, and nothing else", async () => {
    const r = await tool(200, pkg).call({ packageId: "pkg-10-2-26" });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r))).toEqual({ ...pkg, descriptionGuide: DESCRIPTION_SKILL_TEXT });
  });

  it("tells the agent to follow descriptionGuide over the current description's style", () => {
    expect(tool(200, pkg).tool.description).toContain(
      "Before writing or revising a description, follow descriptionGuide exactly; it overrides the current description's style.",
    );
  });

  it("404 says no such package; 400 lists the problem; 401/503 not configured without the token", async () => {
    const missing = await tool(404, { error: "NOT_FOUND" }).call({ packageId: "pkg-1-1-26" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/no package pkg-1-1-26/i);
    const bad = await tool(400, { problems: ["body must be packageId"] }).call({});
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("body must be packageId");
    for (const status of [401, 503]) {
      const r = await tool(status, {}).call({ packageId: "x" });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/not configured/);
      expect(textOf(r)).not.toContain(token);
    }
  });

  it("network failure: an error result, not a throw", async () => {
    const fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const r = await packageGetTool({ siteUrl: "https://x.convex.site", token, fetch }).call({ packageId: "x" });
    expect(r.isError).toBe(true);
  });
});

// Plan 6 (R7/R9): "July 17 is a rerun of March 13" in Chat. It records a fact on the episode; it never approves anything.
describe("episode_mark_rerun", () => {
  const args = { showDate: "2026-07-17", rerunOf: "2026-03-13" };
  const tool = (status: number, body: unknown) => {
    const s = stub(status, body);
    return { s, ...episodeMarkRerunTool({ siteUrl: "https://x.convex.site/", token, fetch: s.fetch }) };
  };

  it("takes the show date and the original's date, only on the person's word, and never mentions approve", () => {
    const { tool: t } = tool(200, {});
    expect(t.name).toBe("episode_mark_rerun");
    expect(Object.keys(t.inputSchema.properties ?? {}).sort()).toEqual(["rerunOf", "showDate"]);
    expect(t.inputSchema.required).toEqual(["showDate", "rerunOf"]);
    expect(t.description).toMatch(/only when the person says so/i);
    expect(t.description).not.toMatch(/approv/i);
  });

  it("sends only those fields with the bearer token to the rerun route", async () => {
    const { s, call } = tool(200, args);
    await call({ ...args, rerunSource: "episodes", status: "approved" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe("https://x.convex.site/agent/episodes/rerun");
    expect(new Headers(s.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual(args);
  });

  it("200: says the week will not be drafted and can be undone on Episodes; never claims approval", async () => {
    const r = await tool(200, args).call(args);
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("2026-07-17");
    expect(textOf(r)).toContain("2026-03-13");
    expect(textOf(r)).toMatch(/not be drafted/);
    expect(textOf(r)).toMatch(/Episodes/);
    expect(textOf(r)).not.toMatch(/approv/i);
  });

  it("400 lists the problems; 404 says no episodes here; 401/503 not configured without the token", async () => {
    const bad = await tool(400, { problems: ["rerunOf must be an earlier show than showDate"] }).call(args);
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("earlier show");
    const missing = await tool(404, { error: "NOT_FOUND" }).call(args);
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/no episodes/i);
    for (const status of [401, 503]) {
      const r = await tool(status, {}).call(args);
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/not configured/);
      expect(textOf(r)).not.toContain(token);
    }
  });

  it("network failure: an error result, not a throw", async () => {
    const fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const r = await episodeMarkRerunTool({ siteUrl: "https://x.convex.site", token, fetch }).call(args);
    expect(r.isError).toBe(true);
  });
});
