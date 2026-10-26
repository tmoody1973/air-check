# 005: Join the audio before approval so Tarik can preview it

**Decision:** The finished show's MP3 is made when the package is drafted, and the approval check covers that exact file.

**Why this came up:** Tarik wants a persistent player that plays the finished show before he approves it. Approve now posts publicly, so hearing it first matters. The original plan made the MP3 only after approval.

**Options:**
1. Join after approval (original). Less storage, but Tarik can't hear what goes public.
2. Join at draft time and include the file's fingerprint (a unique code computed from the file) in the approval. Tarik hears exactly what publishes, at the cost of holding a few large files at once.

**What we chose and why:** Option 2. Tarik chose to preview the finished show; Claude chose to change the order of steps and to cap prepared MP3s at 3.

**What we gave up:** Storage for up to 3 prepared MP3s, and the audio join is now part of the must-work (P0) path.

**How we'll know if this was right:** The approval-gate test "fingerprint covers the mp3" passes, and Tarik previews real shows before approving them.

**What actually happened:**
