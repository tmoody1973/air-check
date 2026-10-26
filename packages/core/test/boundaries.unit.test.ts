import { expect, test } from "vitest";
import { findBoundaryViolations } from "../src/index";

const one = (path: string, content: string) => findBoundaryViolations([{ path, content }]);

test("agent importing the publisher is a violation", () => {
  expect(one("agent/tools/x.ts", 'import { upload } from "../../services/publisher/upload";')).toHaveLength(1);
});

test("Mixcloud upload URL outside the publisher is a violation", () => {
  expect(one("apps/console/x.ts", 'fetch("https://api.mixcloud.com/upload/")')).toHaveLength(1);
  expect(one("services/publisher/upload.ts", 'fetch("https://api.mixcloud.com/upload/")')).toEqual([]);
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
  expect(one("agent/tools/q.ts", 'import { upload } from "@aircheck/publisher";')).toHaveLength(1);
  expect(one("agent/tools/ok.ts", 'import { parseTracklist } from "@aircheck/core";')).toEqual([]);
});

test("agent Python and YAML files are checked too", () => {
  expect(one("agent/hermes/tool.py", 'os.environ["MIXCLOUD_TOKEN"]')).toHaveLength(1);
  expect(one("agent/compose.yaml", "BOX_CLIENT_SECRET: x")).toHaveLength(1);
});
