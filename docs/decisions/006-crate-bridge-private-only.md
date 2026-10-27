# 006: The Crate bridge is reachable only on the server's private network

**Decision:** Air Check reaches Tarik's Crate music-research tools through a small bridge program that runs next to the sandbox and listens only on the Nebius server's private network address. It uses our own encryption certificate and a password-style token, and it exposes research tools only.

**Why this came up:** Crate is a "stdio" MCP server, meaning it expects the program using it to start it directly. NemoClaw only connects sandboxed agents to MCP servers that run as an encrypted (HTTPS) web service with a token. It refuses the "this same machine" shortcut. So something has to sit in between, and it has to live somewhere.

**Options:**
1. **Private only.** The bridge listens on the server's private address (10.x), with a certificate we create. It's never reachable from the internet. Cost: NemoClaw has to be told to trust our certificate, which means rebuilding the sandbox once.
2. **Public HTTPS address plus token.** Faster, with no rebuild. But Crate becomes reachable from the internet, guarded only by the token.

**What we chose and why:** Option 1 (Tarik, on Claude's recommendation). It keeps the "locked room" story intact: the agent's research tools are not on the public internet. The bridge also blocks Crate's publishing tools (`telegraph`, `tumblr`) and its scrapers (`browser`, `whosampled`), and NemoClaw's `--deny-tool` blocks them a second time.

**What we gave up:** One sandbox rebuild, plus our own small certificate authority to look after (renewal, and keeping its private key off the sandbox).

**How we'll know if this was right:** `nemohermes airc mcp status crate` reports ready, with `trustedPrivateTarget.state: match`. A Hermes run calls a `musicbrainz_*` tool. A port scan from outside shows the bridge port closed.

**What actually happened:**


## Addendum 2026-10-27: Tavily page-reading gap

Hermes's `web_extract` tool asks Tavily (`api.tavily.com`, which is allowed) to fetch any URL on Tavily's side. The sandbox never sees that page, so the agent can read arbitrary pages. That undercuts Hard Rule 5 once email reaches the agent (Plan 5).

We tried a custom search-only preset that drops `POST /extract`. It did not close the gap. NemoClaw's Tavily credential provider (profile `tavily-hermes-v1`) carries its own gateway-level rule, `_provider_airc_tavily_search`, which allows both `/search` and `/extract`, and `policy exclude` does not reach it ("Unknown baseline entry"). We went back to the stock `tavily` preset.

Options for Plan 5: remove the Tavily credential (which also loses search), find a provider-level rule change, or use a newer NemoClaw. Decision: revisit at the start of Plan 5 (Tarik's call).
