import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { updateFingerprint } from "../src/index";

// Plan 5c Task 4 (R4): a description update is approved by the hash of the text and its sources the human saw.
const SOURCES = [{ claim: "Played bass with Ezra Collective", source: "crate: musicbrainz artist lookup" }];

test("sha256 over the description plus the sources' JSON; key order does not matter", async () => {
  const expected = createHash("sha256").update(JSON.stringify({ description: "Warm soul.", descriptionSources: SOURCES })).digest("hex");
  expect(await updateFingerprint("Warm soul.", SOURCES)).toBe(expected);
  expect(await updateFingerprint("Warm soul.", [{ source: SOURCES[0]!.source, claim: SOURCES[0]!.claim }])).toBe(expected);
});

test("any change to the text or the sources changes it; no sources hashes the text alone", async () => {
  const base = await updateFingerprint("Warm soul.", SOURCES);
  expect(await updateFingerprint("Warm soul!", SOURCES)).not.toBe(base);
  expect(await updateFingerprint("Warm soul.", [{ ...SOURCES[0]!, source: "crate: discogs" }])).not.toBe(base);
  expect(await updateFingerprint("Warm soul.", undefined)).toBe(createHash("sha256").update(JSON.stringify({ description: "Warm soul." })).digest("hex"));
});
