# 028: The workers send the time, so Convex can serve their questions from its cache

**Decision.** The ingest and publisher workers tell Convex what time it is (ingest sends the current hour, publisher sends today's Chicago date) instead of Convex reading its own clock. The publisher's check for description updates now looks for work before reading anything else. Separately, the ingest worker's polling interval was raised from 1 minute to 5 minutes on the VM (`POLL_MS=300000` in `~/.aircheck/ingest.env`).

**Why this came up.** On Nov 14 the Convex bill showed air-check reading about 12 GB a day from its database, every day, weekends included. That pattern pointed at the background workers, not at people using the console. A 14-minute sample of production logs (each function call reports the bytes it read) showed 131 MB read, which is about 13.6 GB a day:

| Function | Share | Why |
|---|---|---|
| `ingest:list` | 82% | 7.6 MB each time it actually ran: every episode, with its show notes and tracklist text, plus every package |
| `publisher:queue` | 10% | never once served from cache |
| `descriptionUpdates:claim` | 8% | a write, so never cached; it read every release before checking whether there was any work |

Convex keeps a cache: when a question is asked again and nothing it read has changed, it hands back the stored answer for free. A question that reads the clock can't be reused that way, because its answer depends on the moment it was asked. Convex's own guidelines in this repo say so (`apps/console/convex/_generated/ai/guidelines.md`: "Do not read the wall clock in a query"). Both `ingest:list` (to decide whether a draft run is stuck) and `publisher:queue` (to work out "today") read the clock. The workers asked every 30 to 60 seconds, so the expensive reads ran about 1,400 times a day. At stake: a bill that grows with every show we add, since each new episode and package makes every read bigger.

**Options.**
1. Pass the time in (chosen). The worker rounds the time (to the hour, or to the day) and sends it. The same question with the same time gets the cached answer until the underlying data actually changes. Cost: small changes to two Convex functions and two workers, plus a redeploy of both.
2. Only poll less often. No code, and already done for ingest. Cost: changes and fixes take longer to be noticed, and it only divides the cost by 5. It can't reach the target of under 1 GB a day.
3. Shrink what `list` reads: move show-notes and tracklist text into their own table. Cost: a schema change and a data migration on the live database. Kept in reserve in case options 1 and 2 aren't enough.

**What we chose and why.** Options 1 and 2 together (joint: Tarik set the goal of under 1 GB a day, Claude proposed the approach). Option 1 does most of the work with the least risk, and the new inputs are optional, so the old workers keep working while the new code rolls out.

**What we gave up.**
- A draft run that has stalled is now noticed up to an hour later. The stall threshold is 6 hours, so it becomes "6 to 7 hours".
- Ingest picks up a console fix within 5 minutes instead of 1.
- The publisher could, in principle, send the wrong date. That would only skew the 3-per-day pacing count and the "held" list it shows. The step that actually claims a show for upload still checks embargoes against the server's own clock.

**How we'll know if this was right.** A 30-minute production log sample after deploying both workers shows air-check reading under 0.7 MB a minute (under 1 GB a day), and the Convex usage chart for air-check stays under 1 GB a day for the following week.

**What actually happened.**
