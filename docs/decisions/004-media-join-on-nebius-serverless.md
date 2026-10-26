# 004: Join and encode show audio as a Nebius Serverless Job

**Decision:** The step that joins the two hour-long WAV files into one MP3 runs as a Nebius Serverless Job (a task that starts only when needed and then shuts down), not on the main server.

**Why this came up:** The hackathon's Personal AI Track names Nebius Serverless as one of its tools, and the original plan barely used it.

**Options:**
1. A Serverless Job. Uses a named track tool and keeps large audio files off the agent's server, but its limits (disk space for about 1.26 GB of input) are unverified.
2. A container on the main server. Simple and known to work, but it misses a named tool.

**What we chose and why:** Option 1 (Tarik), with option 2 as the fallback if spike V10 fails.

**What we gave up:** Some extra setup, and a dependency on a service we haven't tested.

**How we'll know if this was right:** Spike V10 joins a real show inside a Serverless Job and hands the MP3 to the publisher.

**What actually happened:**
