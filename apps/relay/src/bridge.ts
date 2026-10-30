/**
 * Oct 29 prefetch: tells the bridge a research run is starting, so it runs the job's first web searches before the
 * model asks (the model cannot be trusted to ask; live run, Oct 29 22:33). The bridge asks Convex what to search; a job
 * that is not show notes is a 204. Each workspace uses its own bridge route and that route's MCP token. Never logs.
 */
export interface BridgeConfig { url: string; tokens: { real?: string; demo?: string } }

export function bridgePrefetch(cfg: BridgeConfig, doFetch: typeof fetch = fetch) {
  return async (workspace: "real" | "demo", jobId: string): Promise<void> => {
    const token = cfg.tokens[workspace];
    if (!token) return;
    const res = await doFetch(new URL(workspace === "real" ? "/aircheck/prefetch" : "/aircheck-demo/prefetch", cfg.url), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ job: jobId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`bridge prefetch HTTP ${res.status}`);
  };
}
