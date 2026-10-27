# 012: The console never talks to the agent; a small relay on the VM does

**Decision:** When someone chats or asks for a package draft in the console, the console writes a request into Convex (the hosted database and backend Air Check runs on). A small program on the VM, the relay, watches Convex, starts the agent run, and writes the agent's progress back. The console has no network path to the agent (Hermes, the AI agent that does the research and drafting).

**Why this came up:** Plan 4b makes the console live: a chat box, a "Draft a package" form, a Stop button, a live Trust page. All of them need to start, watch and stop agent runs. The agent runs inside a locked-down sandbox on the Nebius VM (the one cloud machine Air Check deploys to), and the console is the only thing the public internet can reach. If the console could call the agent directly, a mistake in the console, or a hijacked browser session, would have a straight line to a process that can read email-derived content and call research tools.

**Options:**
1. **A relay that talks to Convex (chosen).** The console and the relay only ever meet in the database. The relay holds one secret token (`RELAY_TOKEN`) that works for a short list of Convex functions: pick up queued runs, record events, record the finish, record network activity. It can create no package and approve nothing. Cost: one more service to run and keep alive on the VM, and every agent event makes a hop through the database.
2. **The console calls Hermes directly, over the network.** Simplest to build, and chat could stream word by word. Cost: the public-facing console would need a route to the agent's port, so the agent API could no longer stay on loopback (reachable only from the VM itself), and any bug in a console route becomes a way to drive the agent.
3. **The console talks to Hermes through a tunnel or reverse proxy.** Same reach as option 2 with an extra moving part in the middle. Cost: more to secure and debug, with no gain over option 1's isolation.

**What we chose and why:** Option 1 (Tarik's call, Oct 27). It keeps the rule that the console is the only public entry point and the agent stays on loopback. It also makes the safety claim checkable: a test lists every function the outside world can call, and another reads the run, chat and relay code to confirm none of it reaches the approve or publish path.

**What we gave up:** Chat arrives in chunks about every 500 ms, not token by token, because the relay batches events before writing them to Convex. We also take on one more service on the VM that must run, restart cleanly, and be monitored, and a second secret (`RELAY_TOKEN`) to generate and rotate. If the relay is down, requests simply wait as "queued" and nothing runs.

**How we'll know if this was right:** The Hard Rule 1 test fails if any public function outside its allowlist appears, or if run, chat or relay code mentions the approve/publish functions or writes to the packages table. In use: a chat reply and a package draft both complete end to end with the Hermes port closed to the console, and a run queued while the relay is stopped starts when the relay comes back, instead of being lost.

**What actually happened:**
