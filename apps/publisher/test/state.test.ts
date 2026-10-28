import { stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openState } from "../src/state.js";
import { workspace } from "./helpers.js";

test("R24: the state file's own folder is created 0700 on first write", async () => {
  const ws = await workspace();
  const path = join(ws.dir, "publisher", "state.json");
  const box = await openState(path);
  await box.update((s) => ({ ...s, sentCards: ["pkg-1"] }));
  expect((await stat(join(ws.dir, "publisher"))).mode & 0o777).toBe(0o700);
  expect((await openState(path)).get().sentCards).toEqual(["pkg-1"]);
});
