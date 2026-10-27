import type { AgentPackageInput } from "@aircheck/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

const str = (description: string) => ({ type: "string", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });

// Typed by AgentPackageInput, so a field added or removed in core fails the typecheck here.
const properties: Record<keyof AgentPackageInput, object> = {
  showDate: str("Show date, ISO yyyy-mm-dd"),
  tracklistText: str("The raw tracklist for both hours, as written"),
  leads: strs("Title artists, in order"),
  tags: strs("Mixcloud tags"),
  description: str("Public description, under 1,000 characters"),
  hour1Id: str("Hour 1 audio file id"),
  hour2Id: str("Hour 2 audio file id"),
};
const FIELDS = Object.keys(properties);

const result = (text: string, isError = false): CallToolResult => ({ content: [{ type: "text", text }], isError });

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
      inputSchema: { type: "object", properties, required: FIELDS, additionalProperties: false },
    },

    async call(args) {
      const src = (args !== null && typeof args === "object" ? args : {}) as Record<string, unknown>;
      // Only the named fields travel; anything else the agent adds is dropped here (and again in Convex).
      const body = Object.fromEntries(FIELDS.filter((k) => Object.hasOwn(src, k)).map((k) => [k, src[k]]));
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        return result("Could not reach Air Check to submit. Try again later.", true);
      }
      const data = (await res.json().catch(() => ({}))) as { packageId?: unknown; problems?: unknown };
      switch (res.status) {
        case 201: {
          const id = typeof data.packageId === "string" ? data.packageId : "the package";
          return result(`Submitted ${id} (preparing audio). A person reviews it in the console.`);
        }
        case 400: {
          const problems = Array.isArray(data.problems) ? data.problems.map(String) : ["(no details)"];
          return result(["Not submitted. Fix these problems and submit again:", ...problems.map((p) => `- ${p}`)].join("\n"), true);
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
