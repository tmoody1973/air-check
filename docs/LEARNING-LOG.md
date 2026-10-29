# Learning log

A running retro. Each entry answers three questions: what did we expect, what happened, what do we now believe. The "In my words" line is Tarik's to fill in.

## 2026-10-27: Hermes would not come back after a restart

**What did we expect?** That stopping and starting the VM would bring the whole stack back, because Docker restarts the containers by itself and the console did exactly that.

**What happened?** The console came back, but Hermes (the AI agent) did not. Its sandbox sat in a state called `Error`, and none of the repair commands worked on it. Two causes were stacked. First, the program that supervises the sandbox is a "user" service, and Ubuntu only runs those while someone is logged in over SSH, so after a restart nothing started it. Second, a reboot let Docker kill the sandbox's container before the supervisor had been told to stop, which the supervisor reads as a crash. The only way out was to destroy the sandbox and set it up again (about 45 seconds), and Hermes lost its memory. We then turned on "linger" so user services run without a login, added a boot unit that starts Hermes and retries the port repair, made shutdown stop the sandbox cleanly first, and added a watchdog that messages Tarik on Telegram when Hermes or the bridge is down. The final reboot test passed: Hermes healthy 55 seconds after boot, no alert.

**What do we now believe?** "Restarts itself" has to be tested with a real reboot, not assumed from the parts. It took two failed reboots to find both problems. Anything we run beside a vendor's tool also needs its own alarm, because the vendor's tool did not tell us it was down. Unverified: whether re-onboarding keeps the registered bridge tools, so the runbook says to re-register them.

In my words: 

## 2026-10-27: The test that wrote to production

**What did we expect?** That a test of the new console-to-Hermes path on the dev database would stay on dev. The relay was pointed at dev, so we assumed everything it touched was dev too.

**What happened?** The agent-side bridge had already been switched to prod that morning. When the test draft run called `package_submit`, the call went to prod. One call succeeded and created a test package, `pkg-10-16-26`, on prod. Tarik saw it on the live package page (stuck in "preparing audio", so it could not be approved or published) and deleted it in the Convex dashboard at 12:20 CDT. The same tests also showed something good: without clear rules, the first draft run called `package_submit` 15 times and our own checks rejected every one. With the rules written into the instruction (exact first line, 4 to 6 leads, title template, character budget, at most 5 tags, stop after two rejections) it succeeded.

**What do we now believe?** Before testing any end-to-end path, list every hop and confirm each one points at the same deployment. A test is only as contained as its least-contained step.

In my words:

## 2026-10-28: Installed is not the same as used

**What did we expect?** That installing Tarik's description skill in the agent's sandbox, and naming it in the agent's standing instructions, would make the agent write descriptions in his voice. The skill was installed in both sandboxes, the install script checked it, and the watchdog would alert if it disappeared.

**What happened?** At 14:42 CDT Tarik asked the agent in Chat to rewrite the 10-2-26 description. It came back as a near-copy of the plain text already on Mixcloud, opening line and all. The logs showed why: the agent read the package, wrote the revision and read the package again, and Hermes's own usage file had no entry for the skill. It had never opened it. Tarik said not to approve that proposal and to build a fix. The fix stopped relying on the agent to go and look: the skill's text is now part of Air Check's code and is sent with every draft request and every package read, so the model sees it every time, and a test keeps that copy identical to the skill file. After the fix was deployed at 15:45, the retry at 15:51 came out in Tarik's voice: one paragraph per hour, 4 named songs, no opening line. Tarik approved it, and it was live on Mixcloud at 15:52.

**What do we now believe?** "Installed" and "available" are not "used". When a rule matters, put it where the model cannot skip it, and check what the agent actually did (its usage records and tool calls), not what it was given. The cost is real (about 8,000 extra characters on every run), and the agent now leans on the skill's example wording, so the voice needs watching rather than trusting.

In my words:

## 2026-10-28: The first show went public before the safety test

**What did we expect?** That the first upload would be an unlisted test: a copy only people with the link can see, uploaded by a one-off command with the publisher stopped, so Tarik could check the title, tags, cover and tracklist on Mixcloud and delete it before anything went public.

**What happened?** Tarik connected Mixcloud and approved 10-2-26 from the console at 12:31 CDT. The publisher was running, so it did its job: it claimed the show, checked the MP3, uploaded it in 21 seconds and posted it publicly, with the plain description the agent had written. The unlisted test never ran. The public post answered the test's main question anyway: the tracklist without times shows exactly like Tarik's manual posts. It also showed the description was not good enough, which led to Plan 5c and a way to update a live show's description (used twice that afternoon).

**What do we now believe?** A safety step that depends on doing things in the right order is only as strong as the order. Approve is the real gate, and it worked as built: nothing went up without Tarik pressing it. If a dry run matters, the service that publishes has to be stopped before anyone can press Approve, not after.

In my words:

## 2026-10-29: The agent link kept dropping, and the fix undid itself

**What did we expect?** That once Hermes was up, its link to the console would stay up. The link is the port forward on 127.0.0.1:8642, which carries each connection into the sandbox. When it dropped, we expected the watchdog's `recover` to bring it back, because the watchdog said "reconnected".

**What happened?** The link dropped twice in one day: for nearly 8 hours overnight (about 03:04 to 10:57 UTC), then again from 12:08 to 12:55. A read-only investigation found two problems. First, the forward is a separate program that NemoClaw starts and then leaves alone. Nothing restarts it, and it quit both times during a short stall in the gateway's database. Second, the watchdog's repair could not last. A run of the watchdog is a short-lived systemd job, and systemd stops everything a job started when the job ends. So the forward `recover` started was killed 11 seconds later, after the "reconnected" message had already gone out. The link really came back only when someone ran `recover` by hand. The fix gives each forward its own systemd unit that runs NemoClaw's exact command and restarts it 3 seconds after any exit. The watchdog job is now set to leave behind what it starts (`KillMode=process`).

**What do we now believe?** A repair needs checking after the repair tool has exited, not only inside its own run. The watchdog checked its fix within its own 10 seconds, so it reported success just before systemd removed it. More generally, every long-running process needs an owner that restarts it. A process started from a script or an SSH session has no owner, however stable it looks. The dashboard forwards on 18789 and 18790 are still in that state.

In my words:
