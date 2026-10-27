# 007: The package page freezes what you are reviewing

**Decision:** When you open a package that is waiting for approval, the page keeps the version you opened. If the agent changes the package while you read, the page shows "This package changed. Open the latest version." and Approve is blocked until you tap Reload.

**Why this came up:** The console updates itself live, which is a feature of Convex (the database pushes changes to open pages). The first build used that live version for everything. A reviewer spotted the problem: if the agent revised the description while you were reading, the text would swap under you and Approve would succeed on wording you never saw. The "package changed" safety check could almost never fire.

**Options:**
1. **Live page, warn after the fact.** Simplest. Cost: you can approve text you didn't read.
2. **Freeze the version you opened, and say when it changes.** Approve sends the fingerprint (a short code computed from exactly what will be published) of the version on screen, so the server refuses if anything moved. Cost: one extra tap (Reload) whenever the package really does change, including when the audio finishes preparing.

**What we chose and why:** Option 2 (Claude, during the build; Tarik can overrule). "Approve means you saw it" is the point of the approval gate (Hard Rule 1).

**What we gave up:** An extra Reload tap. A package that moves from "preparing audio" to "ready" also shows the notice once, because its content really did change.

**How we'll know if this was right:** Nobody reports approving something that differed from what they read, and the Reload notice doesn't show up so often that people tap through it without looking.

**What actually happened:**
