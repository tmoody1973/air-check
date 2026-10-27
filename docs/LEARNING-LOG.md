# Learning log

A running retro. Each entry answers three questions: what did we expect, what happened, what do we now believe. The "In my words" line is Tarik's to fill in.

## 2026-10-27: Hermes would not come back after a restart

**What did we expect?** That stopping and starting the VM would bring the whole stack back, because Docker restarts the containers by itself and the console did exactly that.

**What happened?** The console came back, but Hermes (the AI agent) did not. Its sandbox sat in a state called `Error`, and none of the repair commands worked on it. Two causes were stacked. First, the program that supervises the sandbox is a "user" service, and Ubuntu only runs those while someone is logged in over SSH, so after a restart nothing started it. Second, a reboot let Docker kill the sandbox's container before the supervisor had been told to stop, which the supervisor reads as a crash. The only way out was to destroy the sandbox and set it up again (about 45 seconds), and Hermes lost its memory. We then turned on "linger" so user services run without a login, added a boot unit that starts Hermes and retries the port repair, made shutdown stop the sandbox cleanly first, and added a watchdog that messages Tarik on Telegram when Hermes or the bridge is down. The final reboot test passed: Hermes healthy 55 seconds after boot, no alert.

**What do we now believe?** "Restarts itself" has to be tested with a real reboot, not assumed from the parts. It took two failed reboots to find both problems. Anything we run beside a vendor's tool also needs its own alarm, because the vendor's tool did not tell us it was down. Unverified: whether re-onboarding keeps the registered bridge tools, so the runbook says to re-register them.

In my words: 
