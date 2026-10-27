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
