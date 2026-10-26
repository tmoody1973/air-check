# Spikes

Results of time-boxed verification spikes (see BUILD_PLAN.md Day 1 and the design spec section 11).

| Spike | Date | Result | Notes |
|---|---|---|---|

## Core rules (Plan 1)

`packages/core` is the deterministic rules engine. Its golden test reconciles the 10-2-26 Drive tracklist against the Paper notes and produces exactly the 31 tracks (15 + 16) of `fixtures/RLR-10-2-26-mixcloud-package.md` section 5, with both closing tracks marked and the Paper spellings (Lý Qua Dub, Quiñones, Adigéry, Gutiérrez, Cóndor). The approval gate tests cover Hard Rule 1 (only a signed-in @radiomilwaukee.org human decides), Hard Rule 9 (demo never publishes) and the double-approve race. A repo-wide boundary scan fails the build if code outside the publisher references the Mixcloud upload URL, if agent code references source credentials, or if `start_time` appears anywhere in code.

**Not real yet:** `fixtures/raw/10-2-26-drive-tracklist.txt` and `10-2-26-paper-tracks.txt` are synthesized from the golden fixture (design spec 5.6). Replace them with the real Drive export and a redacted Paper excerpt when available.
