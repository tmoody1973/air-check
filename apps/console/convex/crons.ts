import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The demo workspace stays open to judges until Dec 15. The first approval consumes the one golden
// demo package and seeded activity ages out of Today's "since 6 pm yesterday" window, so re-seed hourly.
// seedDemo is internal, touches only the "demo" workspace, keeps visitors' rows for 24 h and never deletes a live run.
crons.interval("reseed demo workspace", { hours: 1 }, internal.seed.seedDemo, {});

export default crons;
