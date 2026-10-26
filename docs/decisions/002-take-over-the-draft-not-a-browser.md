# 002: "Take over" means taking over the draft, not a browser

**Decision:** Long jobs show live progress, and a Take over button stops the agent and hands Tarik the half-finished draft. The agent does not get a web browser.

**Why this came up:** Tarik liked OpenMuse's browser takeover, where the AI drives a real browser and you can grab the controls. In Air Check, the AI is not allowed to open links, and its "locked room" can reach only a short list of approved services. A real browser would need a hole in that room.

**Options:**
1. Watch the agent work (for example "checking release dates, 12 of 29"), then take over the draft. No new access needed.
2. Give the agent a real browser that Tarik can take control of. More flexible, but it breaks the no-links rule and weakens the privacy promise.

**What we chose and why:** Option 1 (Tarik). It gives the "I can see it and step in" feeling without weakening the sandbox.

**What we gave up:** The agent cannot read arbitrary web pages. Research goes only through approved tools (Crate, Tavily).

**How we'll know if this was right:** Tarik uses Take over on real show notes and doesn't wish he could see web pages instead. The audit log shows no new allowed hosts.

**What actually happened:**
