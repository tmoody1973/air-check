# 008: The judges' demo workspace resets every hour

**Decision:** A scheduled job in Convex (`convex/crons.ts`) reloads the demo workspace's sample data every hour. It only ever touches demo records, never real ones.

**Why this came up:** Judges can test Air Check until Dec 15, and they all share one demo login. The final review found two ways the demo would quietly break. First, the first judge to tap Approve uses up the one sample package, so every later judge sees no Approve button. Second, the "blocked overnight" card on Today counts events since 6 pm yesterday, so a day after loading the sample data it goes empty, and that card is the demo's main trust moment.

**Options:**
1. **Reset on a schedule (hourly).** Cost: a judge's approval lasts at most an hour, and a judge caught mid-review at the top of the hour sees "This package changed" and has to tap Reload.
2. **Reset every time someone opens `/demo`.** Cost: two judges at once would wipe each other's state mid-session.
3. **Give each judge their own demo copy.** Cleanest experience. Cost: per-visitor demo data and cleanup, which is far more code for a hackathon.

**What we chose and why:** Option 1 (Claude, in the final review fix; Tarik can change the interval). It fixes both problems with five lines and no new moving parts.

**What we gave up:** Approvals in the demo don't stick for long, and there are a few hourly writes to the database for as long as the demo is live.

**How we'll know if this was right:** On any day before Dec 15, a fresh `/demo` sign-in shows a package ready to approve and a non-empty "blocked overnight" card. The Convex dashboard's cron history shows the job running hourly without errors.

**What actually happened:**
