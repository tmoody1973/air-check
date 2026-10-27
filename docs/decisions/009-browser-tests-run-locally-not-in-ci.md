# 009: The click-through browser tests run on Tarik's machine, not in CI

**Decision:** The end-to-end tests (Playwright, a tool that drives a real browser like a person would, including at iPhone width) run locally with `pnpm --filter console e2e`. CI, the automatic checks GitHub runs on every change, runs the unit tests, the type check and the build, but not these browser tests.

**Why this came up:** The browser tests sign in through Clerk and read and write the Convex database, so they need the Clerk secret key and the Convex deployment key. Putting those keys into GitHub would mean the public repo's CI holds credentials to the real sign-in and database services.

**Options:**
1. **Local only.** Cost: a change can break the phone layout or the approve flow without CI noticing, unless someone runs the tests.
2. **CI with secrets stored in GitHub.** Cost: credentials live in a public repo's settings, and every CI run writes to the demo database.
3. **CI against a separate throwaway Clerk and Convex setup.** Cost: a second set of services to create and maintain.

**What we chose and why:** Option 1 for now (Claude, during the build). Hard rule: secrets live only in `.env.local` and the Convex dashboard. Option 3 is the right upgrade once Air Check is live and someone else contributes.

**What we gave up:** Automatic protection for the most demo-visible behaviour. The phone-width test was proven able to fail (it caught a deliberately widened card), but only when someone runs it.

**How we'll know if this was right:** Before every merge to `main` and before the deploy, someone runs `pnpm --filter console e2e` and it passes. If a layout or sign-in bug ever reaches the live demo that these tests would have caught, switch to option 3.

**What actually happened:**
