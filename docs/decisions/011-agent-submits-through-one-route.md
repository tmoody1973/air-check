# 011: The agent submits a package through one narrow route, not with the Convex deploy key

**Decision:** The host-side bridge (the small program that carries the agent's finished package to the console) gets a secret token that works for exactly one web address on the Convex backend, `POST /agent/packages`. It does not get the Convex deploy key.

**Why this came up:** When the agent finishes a draft, something has to put it in the database. Convex (the hosted database and backend Air Check runs on) offers a deploy key, a master password for the deployment. The core promise of Air Check is that the agent can draft but only a signed-in human can approve, so whatever credential the bridge holds decides how much damage a mistake or a hijacked agent could do.

**Options:**
1. **A narrow token for one route (chosen).** The bridge sends the package fields with the token. The route ignores everything except seven named fields, rebuilds the whole draft itself in code (status, workspace and fingerprint (a hash of the exact package contents, so an approval only counts for that version) are set by the server, never by the sender), checks it against the rules, and only then saves it as a `preparing_audio` draft (a draft still waiting for its audio files, not yet reviewable). Cost: one more small piece of backend code to maintain, a token to generate and rotate, and a new public web address that must be tested hard.
2. **Give the bridge the Convex deploy key.** The bridge could call the save function directly. Cost: that key can also push new backend code and call the functions that start and record a publish (`claimForPublish`, `recordResult`). One leaked or misused key would turn "the agent drafts" into "something can publish", which breaks the central rule.

**What we chose and why:** Option 1 (Tarik, on Claude's recommendation, Oct 26). The token can only create a draft, so the worst a stolen token can do is add drafts that a human still has to review and approve. Tests pin this: the route list is exactly one entry, and it may reference only the one internal save function.

**What we gave up:** Simplicity. The deploy key would have worked in a few lines with no new endpoint. We also accept that anyone holding the token can create drafts (not approve them), so it must be kept out of the agent's own process and rotated if it leaks.

**How we'll know if this was right:** A forged request with extra fields (`status: "approved"`, `workspace: "demo"`) still produces an unapproved `real` draft; the Hard Rule 1 test fails if a second route appears or if the route files name any Convex function other than the one save function (it checks the source text, not every possible call path); and the bridge host holds no Convex deploy key.

**What actually happened:**
