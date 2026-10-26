import { expect, test } from "vitest";
import { assembleEpisode, type BoxFile } from "../src/index";

const MB = 1_000_000;
const f = (name: string, size = 630 * MB, id = name): BoxFile => ({ id, name, size });

test("golden 10-2-26 folder is ready with 9125/9126", () => {
  const files = [
    f("9125.wav", 632_418_686, "box-h1"),
    f("9126.wav", 628_847_962, "box-h2"),
    ...["9101", "9102", "9103", "9104", "9105", "9201", "9202", "9203", "9204", "9205", "9120"].map((n) => f(`${n}.wav`)),
    f("RLR Tonight at 6.wav"),
    f("RLR Tonight at 8.wav"),
  ];
  const a = assembleEpisode("10-2-26", files);
  expect(a).toMatchObject({ status: "ready", date: "2026-10-02", pattern: "9125-9126", flags: [] });
  expect(a.hour1?.id).toBe("box-h1");
  expect(a.hour2?.id).toBe("box-h2");
  expect(a.ignored).toHaveLength(13);
});

test("29934/29935 pattern", () => {
  const a = assembleEpisode("5-22-26", [
    f("29934_Rhythm Lab Radio hour 1_Tarik Moody_052226.wav"),
    f("29935_Rhythm Lab Radio hour 2_Tarik Moody_052226.wav"),
  ]);
  expect(a).toMatchObject({ status: "ready", pattern: "29934-29935" });
});

test("RLR Full Hour pattern with inconsistent spacing", () => {
  const a = assembleEpisode("3-20-26", [f("RLR - Full Hour 1 - 032026.wav"), f("RLR- Full Hour 2 - 032026.wav")]);
  expect(a).toMatchObject({ status: "ready", pattern: "rlr-full-hour" });
});

test("zero-padded folder date", () => {
  expect(assembleEpisode("1-09-26", [f("9125.wav"), f("9126.wav")]).date).toBe("2026-01-09");
});

test("only one hour is incomplete", () => {
  const a = assembleEpisode("10-2-26", [f("9125.wav")]);
  expect(a.status).toBe("incomplete");
  expect(a.hour1?.name).toBe("9125.wav");
});

test("special folders ask first", () => {
  expect(assembleEpisode("RECAP 2026", [f("9125.wav"), f("9126.wav")]).status).toBe("ask");
  expect(assembleEpisode("Best of 2025", [f("9125.wav"), f("9126.wav")]).status).toBe("ask");
});

test("file date that disagrees with folder asks", () => {
  const a = assembleEpisode("5-22-26", [
    f("29934_Rhythm Lab Radio hour 1_Tarik Moody_052326.wav"),
    f("29935_Rhythm Lab Radio hour 2_Tarik Moody_052326.wav"),
  ]);
  expect(a.status).toBe("ask");
  expect(a.flags).toContain("date mismatch");
});

test("size checks flag a short hour but stay ready", () => {
  const a = assembleEpisode("10-2-26", [f("9125.wav", 632 * MB), f("9126.wav", 400 * MB)]);
  expect(a.status).toBe("ready");
  expect(a.flags).toEqual(["hour 2 size out of range", "hour sizes differ by more than 10%"]);
});
