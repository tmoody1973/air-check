# 003: OpenMuse is a pattern reference, not a dependency

**Decision:** Borrow design patterns from CopilotKit's OpenMuse (MIT): the approval gate, Ideas accept/edit/dismiss, the activity-and-receipts view and the labeled demo mode. Keep Hermes Agent as the agent.

**Why this came up:** Tarik pointed to OpenMuse as inspiration. One message briefly read as "replace Hermes and NemoClaw". Tarik clarified that the hackathon requires them.

**Options:**
1. Use OpenMuse's agent stack in place of Hermes. Fewer integration risks, but it fails the hackathon's tool requirements, and its default telemetry and hosted thread storage break Air Check's privacy rules.
2. Keep Hermes and borrow OpenMuse's patterns. Meets the requirements, but the riskiest connection (console to Hermes) still has to be proven.

**What we chose and why:** Option 2 (joint: Tarik set the requirement, Claude proposed which patterns to borrow).

**What we gave up:** OpenMuse's ready-made streaming chat. How the console talks to Hermes is still unproven (spike V2b).

**How we'll know if this was right:** The approval gate and Trust view ship without any CopilotKit telemetry, and spike V2b passes.

**What actually happened:**
