# 001: Approve from the phone through a link into the console

**Decision:** Telegram only notifies and links. Approving a Mixcloud package happens only on that package's page in the signed-in console.

**Why this came up:** Tarik wants to approve packages from his phone in the morning. The handoff originally put Approve buttons inside Telegram. But the AI agent runs the Telegram connection, so a tap there would pass through the agent. That would create a path from the AI to a public post, which the product's first rule forbids.

**Options:**
1. Approve buttons inside Telegram. Fastest for Tarik, but the tap travels through the agent.
2. Telegram sends a link, and Approve lives in the signed-in console. One extra tap and maybe a sign-in, but only a verified human can publish.
3. A "magic link" that approves when opened. One tap, but anyone holding the link could publish, and link previews in chat apps can open links by themselves.

**What we chose and why:** Option 2 (Tarik). It keeps phone approval and keeps the rule that only a signed-in human publishes.

**What we gave up:** Approving takes a little longer, and the package page now has to work well on a phone screen.

**How we'll know if this was right:** Tarik approves real packages from his phone without frustration, and the approval-gate tests show that nothing except a signed-in @radiomilwaukee.org user can approve.

**What actually happened:**
