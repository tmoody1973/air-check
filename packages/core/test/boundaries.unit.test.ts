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
