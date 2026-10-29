import { expect, test } from "vitest";
import { findBoundaryViolations } from "../src/index";

const one = (path: string, content: string) => findBoundaryViolations([{ path, content }]);

test("agent importing the publisher is a violation", () => {
  expect(one("agent/tools/x.ts", 'import { upload } from "../../services/publisher/upload";')).toHaveLength(1);
});

test("Mixcloud upload URL outside the publisher's source is a violation", () => {
  const upload = 'fetch("https://api.mixcloud.com/upload/")';
  expect(one("apps/publisher/src/mixcloud.ts", upload)).toEqual([]);
  for (const path of ["apps/console/x.ts", "apps/media/src/x.ts", "apps/relay/src/x.ts", "agent/x.ts", "apps/publisher/test/x.test.ts", "services/publisher/upload.ts", "deploy/publisher/x.sh"]) {
    expect(one(path, upload), path).toEqual([`${path}: Mixcloud upload URL outside apps/publisher/src (Hard Rule 1)`]);
  }
});

test("agent reading source or Mixcloud credentials is a violation", () => {
  expect(one("agent/env.ts", "const t = process.env.MIXCLOUD_TOKEN;")).toHaveLength(1);
  expect(one("agent/env.ts", "const t = process.env.BOX_CLIENT_SECRET;")).toHaveLength(1);
  expect(one("agent/env.ts", "const t = process.env.NEBIUS_API_KEY;")).toEqual([]);
});

test("start_time anywhere in code is a violation", () => {
  expect(one("services/media/x.ts", "fields.start_time = 0;")).toHaveLength(1);
});

test("docs, skills, fixtures and markdown are exempt", () => {
  for (const path of ["docs/a.ts", "skills/x/y.ts", "fixtures/z.json", "README.md"])
    expect(one(path, "start_time api.mixcloud.com/upload")).toEqual([]);
});

test("agent reaching the approval gate or publish steps is a violation", () => {
  expect(one("agent/tools/approve.ts", 'import { ApprovalGate } from "@aircheck/core";\nnew ApprovalGate(s)')).toHaveLength(1);
  expect(one("agent/tools/p.ts", "await gate.claimForPublish(id)")).toHaveLength(1);
  expect(one("agent/tools/u.ts", 'await gate.unclaim(id, "invalid_token")')).toHaveLength(1);
  expect(one("agent/tools/q.ts", 'import { upload } from "@aircheck/publisher";')).toHaveLength(1);
  expect(one("agent/tools/ok.ts", 'import { parseTracklist } from "@aircheck/core";')).toEqual([]);
});

test("agent Python and YAML files are checked too", () => {
  expect(one("agent/hermes/tool.py", 'os.environ["MIXCLOUD_TOKEN"]')).toHaveLength(1);
  expect(one("agent/compose.yaml", "BOX_CLIENT_SECRET: x")).toHaveLength(1);
});

test("Box, Google and Dropbox API hosts appear only in the ingest service and the console's Connect routes (Hard Rule 2)", () => {
  const hosts = [
    "https://api.box.com/oauth2/token", "https://dl.boxcloud.com/d/1", "https://oauth2.googleapis.com/token",
    "https://www.googleapis.com/drive/v3/files", "https://accounts.google.com/o/oauth2/v2/auth",
    "https://api.dropboxapi.com/2/files/list_folder", "https://content.dropboxapi.com/2/files/export", "https://www.dropbox.com/oauth2/authorize",
  ];
  const allowed = [
    "apps/ingest/src/box.ts", "apps/ingest/src/drive.ts", "apps/ingest/test/box.test.ts", "apps/console/src/lib/oauth.ts", "apps/console/src/lib/ingestOAuth.ts",
    "apps/console/src/lib/ingestOAuth.test.ts", "apps/console/src/app/api/google/callback/route.ts", "apps/console/src/app/api/dropbox/authorize/route.ts",
    "apps/console/src/app/api/ingestSources.routes.test.ts",
  ];
  for (const path of allowed) for (const h of hosts) expect(one(path, `fetch("${h}")`), path).toEqual([]);
  for (const path of ["agent/x.ts", "apps/bridge/src/x.ts", "apps/relay/src/x.ts", "apps/media/src/x.ts", "apps/console/convex/x.ts", "apps/console/src/lib/other.ts", "apps/ingestor/src/x.ts", "deploy/x.sh"]) {
    for (const h of hosts) expect(one(path, `fetch("${h}")`), `${path} ${h}`).toEqual([`${path}: Box, Google or Dropbox API host outside apps/ingest/src and the Connect routes (Hard Rule 2)`]);
  }
  // Google Fonts is not the Drive API.
  expect(one("apps/console/src/app/layout.tsx", "https://fonts.googleapis.com/css2")).toEqual([]);
});

// Plan 8: the console receives email and fetches nothing; only the ingest worker talks to Token Factory and Bandcamp.
test("api.agentmail.to appears only in the console's AgentMail client", () => {
  const url = 'fetch("https://api.agentmail.to/v0/inboxes")';
  expect(one("apps/console/src/lib/agentmail.ts", url)).toEqual([]);
  for (const path of ["apps/console/src/app/api/agentmail/inbound/route.ts", "apps/console/src/lib/other.ts", "apps/ingest/src/x.ts", "apps/bridge/src/x.ts", "agent/x.py"]) {
    expect(one(path, url), path).toEqual([`${path}: AgentMail API host outside apps/console/src/lib/agentmail.ts (Plan 8)`]);
  }
});

test("tokenfactory.nebius.com appears in apps/ only in the ingest worker's extractor client", () => {
  const url = 'fetch("https://api.tokenfactory.nebius.com/v1/chat/completions")';
  expect(one("apps/ingest/src/tokenFactory.ts", url)).toEqual([]);
  for (const path of ["apps/console/src/lib/x.ts", "apps/console/convex/x.ts", "apps/console/src/app/api/agentmail/inbound/route.ts", "apps/ingest/src/main.ts", "apps/bridge/src/x.ts"]) {
    expect(one(path, url), path).toEqual([`${path}: Token Factory host outside apps/ingest/src/tokenFactory.ts (Plan 8)`]);
  }
});

test("a file that names bandcamp.com and calls fetch( is only the ingest worker's Bandcamp page reader", () => {
  const code = 'await fetch("https://x.bandcamp.com/album/a")';
  expect(one("apps/ingest/src/bandcamp.ts", code)).toEqual([]);
  for (const path of ["apps/console/src/lib/x.ts", "apps/console/src/app/api/agentmail/inbound/route.ts", "apps/ingest/src/main.ts", "apps/bridge/src/x.ts"]) {
    expect(one(path, code), path).toEqual([`${path}: fetches next to bandcamp.com outside apps/ingest/src/bandcamp.ts (Plan 8)`]);
  }
  // Naming the domain without fetching (the bridge's allow-list, core's rules) is fine.
  expect(one("apps/bridge/src/allowlist.ts", 'host === "bandcamp.com"')).toEqual([]);
  expect(one("packages/core/src/radar/bandcamp.ts", 'const BANDCAMP_DOMAIN = "bandcamp.com"')).toEqual([]);
});

test("no attachments or send call anywhere in apps/", () => {
  for (const s of ['`/inboxes/${i}/messages/${m}/attachments/${a}`', '"/inboxes/x/messages/send"']) {
    for (const path of ["apps/console/src/lib/agentmail.ts", "apps/ingest/src/x.ts", "apps/console/convex/x.ts"]) {
      expect(one(path, s), path).toHaveLength(1);
    }
  }
});

test("tests are exempt from the Plan 8 rules", () => {
  const all = 'fetch("https://api.agentmail.to/v0/x/attachments"); fetch("https://api.tokenfactory.nebius.com"); fetch("https://x.bandcamp.com/album/a") // messages/send';
  for (const path of ["apps/console/src/app/api/agentmail/inbound/route.test.ts", "apps/ingest/test/bandcamp.test.ts", "apps/console/convex/radar.test.ts"]) {
    expect(one(path, all), path).toEqual([]);
  }
});
