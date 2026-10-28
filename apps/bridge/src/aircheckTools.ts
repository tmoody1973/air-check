import type { AgentPackageInput } from "@aircheck/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

const str = (description: string) => ({ type: "string", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });

// Typed by AgentPackageInput, so a field added or removed in core fails the typecheck here.
const sourcesSchema = {
  type: "array",
  description: "Private: where each fact in the description came from. Up to 12 entries, each field under 300 characters",
  items: { type: "object", properties: { claim: str("The fact"), source: str("The Crate result it came from") }, required: ["claim", "source"], additionalProperties: false },
};

const properties: Record<keyof AgentPackageInput, object> = {
  showDate: str("Show date, ISO yyyy-mm-dd"),
  tracklistText: str("The raw tracklist for both hours, as written"),
  leads: strs("Title artists, in order"),
  tags: strs("Mixcloud tags"),
  description: str("Public description, under 1,000 characters"),
  descriptionSources: sourcesSchema,
  hour1Id: str("Hour 1 audio file id"),
  hour2Id: str("Hour 2 audio file id"),
};
const FIELDS = Object.keys(properties);

const result = (text: string, isError = false): CallToolResult => ({ content: [{ type: "text", text }], isError });

/** POSTs only the named fields of `args` with the bearer token; null when Air Check could not be reached. */
async function postFields(
  doFetch: typeof fetch,
  url: string,
  token: string,
  fields: readonly string[],
  args: unknown,
): Promise<{ status: number; data: Record<string, unknown> } | null> {
  const src = (args !== null && typeof args === "object" ? args : {}) as Record<string, unknown>;
  // Only the named fields travel; anything else the agent adds is dropped here (and again in Convex).
  const body = Object.fromEntries(fields.filter((k) => Object.hasOwn(src, k)).map((k) => [k, src[k]]));
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return null;
  }
}

const problemList = (data: Record<string, unknown>) => (Array.isArray(data.problems) ? data.problems.map(String) : ["(no details)"]);

export interface PackageSubmitTool {
  tool: Tool;
  call(args: unknown): Promise<CallToolResult>;
}

/** `package_submit`: forwards the seven draft fields to Convex. It drafts; it can never approve (Hard Rule 1). */
export function packageSubmitTool(opts: { siteUrl: string; token: string; fetch?: typeof fetch }): PackageSubmitTool {
  const doFetch = opts.fetch ?? fetch;
  const url = new URL("/agent/packages", opts.siteUrl).toString();

  return {
    tool: {
      name: "package_submit",
      description:
        "Submit a Mixcloud package draft. Air Check rebuilds and checks it; a person reviews it in the console.",
      inputSchema: { type: "object", properties, required: FIELDS.filter((k) => k !== "descriptionSources"), additionalProperties: false },
    },

    async call(args) {
      const res = await postFields(doFetch, url, opts.token, FIELDS, args);
      if (!res) return result("Could not reach Air Check to submit. Try again later.", true);
      const { data } = res;
      switch (res.status) {
        case 201: {
          const id = typeof data.packageId === "string" ? data.packageId : "the package";
          return result(`Submitted ${id} (preparing audio). A person reviews it in the console.`);
        }
        case 400: {
          return result(["Not submitted. Fix these problems and submit again:", ...problemList(data).map((p) => `- ${p}`)].join("\n"), true);
        }
        case 409:
          return result("Already submitted: a package for this show already exists. A person reviews it in the console.", true);
        case 401:
        case 503:
          return result("Package submit is not configured on the bridge. Tell the operator; do not retry.", true);
        default:
          return result(`Submit failed (HTTP ${res.status}). Try again later.`, true);
      }
    },
  };
}

const REVISE_FIELDS = ["packageId", "description", "descriptionSources"] as const;

/**
 * `package_revise`: a new public description (and its private sources) for a package waiting for review. Air Check
 * checks it like a submit and the package goes back to review with a new fingerprint. It drafts; it can never
 * approve (Hard Rule 1): only a signed-in person's Approve of the new text publishes it.
 */
export function packageReviseTool(opts: { siteUrl: string; token: string; fetch?: typeof fetch }): PackageSubmitTool {
  const doFetch = opts.fetch ?? fetch;
  const url = new URL("/agent/packages/revise", opts.siteUrl).toString();

  return {
    tool: {
      name: "package_revise",
      description:
        "Rewrite the public description of a package waiting for review, with the sources for its facts. Air Check checks it; a person reviews the new text in the console.",
      inputSchema: {
        type: "object",
        properties: { packageId: str("The package id, e.g. pkg-10-2-26"), description: str("New public description, under 1,000 characters"), descriptionSources: sourcesSchema },
        required: ["packageId", "description"],
        additionalProperties: false,
      },
    },

    async call(args) {
      const res = await postFields(doFetch, url, opts.token, REVISE_FIELDS, args);
      if (!res) return result("Could not reach Air Check to revise. Try again later.", true);
      const { data } = res;
      const id = typeof data.packageId === "string" ? data.packageId : String((args as { packageId?: unknown } | null)?.packageId ?? "the package");
      switch (res.status) {
        case 200:
          return result(`Revised ${id}: back in review. A person reviews the new description in the console.`);
        case 400:
          return result(["Not revised. Fix these problems and revise again:", ...problemList(data).map((p) => `- ${p}`)].join("\n"), true);
        case 404:
          return result(`Not revised: no package ${id} in this workspace.`, true);
        case 409:
          return result(`Not revised: ${typeof data.error === "string" ? data.error : "the package cannot change now"}.`, true);
        case 401:
        case 503:
          return result("Package revise is not configured on the bridge. Tell the operator; do not retry.", true);
        default:
          return result(`Revise failed (HTTP ${res.status}). Try again later.`, true);
      }
    },
  };
}
