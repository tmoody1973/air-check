# 013: Judges get a live agent in its own sandbox, with limits

**Decision:** The demo workspace that judges sign in to talks to a real Hermes agent (the AI agent that does Air Check's research and drafting), running in a second sandbox called `aircdemo`, separate from the real one. It has hard limits: a few runs per visitor, a daily cap, no memory, and package ids that can never collide with real ones.

**Why this came up:** Plan 4b made chat and "Draft a package" live for Tarik. Judges test the product until Dec 15 through a shared demo login. If the demo only replayed recorded answers, judges would never see the agent actually work, and a working agent is what the hackathon is judging. But a live agent open to strangers can burn model credit, leave things behind for the next visitor, or reach Tarik's real data if it shares his sandbox. Getting this wrong means either an unconvincing demo or a judge's chat ending up near real work.

**Options:**
1. **Scripted only.** Every demo chat and draft replays a recorded run. Cost: nothing live to show; a judge who types their own question gets a canned answer that doesn't match it.
2. **A live demo sandbox with limits (chosen).** A second sandbox with its own port, its own bridge route that can only write demo packages, and limits in Convex: 5 runs per visitor session per 10 minutes, 40 live runs per day (after that, runs fall back to the recording), and `DEMO_LIVE=0` as an off switch. Cost: a second sandbox to boot, watch and keep healthy on the one VM, more model spend, and limits that a determined visitor can still use up for the day.
3. **Live, in Tarik's real sandbox.** No second sandbox to run. Cost: judges' chats would share memory, tools and a session store with Tarik's real work, and one mistake in workspace checks would cross the line. Not acceptable.

**What we chose and why:** Option 2 (Tarik's call, Oct 27). It shows the real agent while keeping judges in a separate sandbox from the real workspace. The details that came with it:

- **Demo memory is off** (ruling R22). The spec asked for "sample memory" in the demo. Instead, the demo sandbox has Hermes's memory and user profile switched off, so no judge can leave anything behind for the next one, and there is no nightly reset job that could break.
- **Every demo visitor can read every demo chat.** All judges share one demo login, so conversations are shared too. The sidebar says so: "Chats here are visible to other visitors." Visitors' chats, runs and packages are kept for 24 hours by the hourly reset (decision 008), and a run still in progress is never deleted.
- **Demo package ids are unique.** A demo draft's id gets five random letters and digits on the end (`demo-10-2-26-x7k2q`), so many judges can draft the same show date, and none of them collides with the sample package `demo-10-2-26` or a real `pkg-` id.
- **The judge live test waits until after merge** (ruling R23). Checking a live demo chat, a demo draft, the 6th-run refusal and the scripted fallback needs the new console on prod, which only happens after the merge and a redeploy. The checklist is in `docs/DEPLOY.md` under "Before judges are told the demo is live".

**What we gave up:** The demo agent does not learn or remember anything, so it can't show off Hermes's memory. Judges can see each other's chats. A second sandbox uses VM memory and model credit and is one more thing that can be down (the watchdog checks it). Until the post-merge checklist runs, nobody has seen a live demo run on prod, and the scripted fallback still replays a placeholder recording (10-9-26) rather than the 10-2-26 draft.

**How we'll know if this was right:** Every item on the post-merge checklist passes on prod. Through Dec 15, the demo sandbox's memory folder stays empty, no `pkg-` row is ever created from the demo login, the real sandbox `airc` keeps running when the demo sandbox fails, and daily model spend stays within the 40-run cap.

**What actually happened:**
