import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { openState } from "../src/state.js";
import { cardsPass, readTelegramSecrets, sendReadyCards, sendResearchCards, telegramSender } from "../src/telegram.js";
import { BOT_TOKEN, fakeConvex, fakeServer, workspace } from "./helpers.js";

type Server = Awaited<ReturnType<typeof fakeServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const review = [
  { packageId: "pkg-10-2-26", title: "Rhythm Lab Radio 10.2.26", trackCount: 31, flagCount: 2 },
  { packageId: "pkg-10-9-26", title: "Rhythm Lab Radio 10.9.26", trackCount: 1, flagCount: 0 },
];

async function setup() {
  server = await fakeServer();
  const ws = await workspace();
  await writeFile(ws.secretsFile, `OTHER_SECRET=nope\nTELEGRAM_BOT_TOKEN=${BOT_TOKEN}\nTELEGRAM_ALLOWED_IDS=4242,999\n`);
  const list = [...review];
  const research = [{ jobId: "rj-abc123", showDate: "2026-10-30", ready: true, changes: 2, open: 3 }, { jobId: "rj-def456", showDate: "2026-10-23", ready: true, changes: 0, open: 1 }];
  const fake = fakeConvex([], { review: list, research });
  const logs: string[] = [];
  const deps = async () => ({
    convex: fake.convex, state: await openState(ws.stateFile), appUrl: "https://aircheck.example/",
    send: telegramSender(ws.secretsFile, server!.base), log: (l: string) => logs.push(l),
  });
  const sent = () => server!.seen.filter((s) => s.path.endsWith("/sendMessage"));
  return { ws, fake, logs, deps, sent, list, research };
}

describe("ready cards", () => {
  test("one card per package, link only, to the first allowed chat; not re-sent after a restart", async () => {
    const s = await setup();
    await sendReadyCards(await s.deps());
    expect(s.sent()).toHaveLength(2);
    const first = s.sent()[0]!;
    expect(first.method).toBe("POST");
    expect(first.path).toBe(`/bot${BOT_TOKEN}/sendMessage`);
    const body = JSON.parse(first.body.toString());
    expect(body.chat_id).toBe("4242");
    expect(body.text).toBe("Rhythm Lab Radio 10.2.26\n31 tracks · 2 flags\nReview package: https://aircheck.example/packages/pkg-10-2-26");
    expect(body).not.toHaveProperty("reply_markup"); // never an approve button
    await sendReadyCards(await s.deps()); // a restart: fresh memory, same state file
    expect(s.sent()).toHaveLength(2);
    for (const line of s.logs) expect(line).toMatch(/^publish package=[\w-]+ step=card ok=true ms=\d+$/);
    expect(s.logs.join("\n")).not.toContain(BOT_TOKEN);
  });

  test("a failed send is retried next time; a package that left review is forgotten", async () => {
    const s = await setup();
    await writeFile(s.ws.secretsFile, "TELEGRAM_ALLOWED_IDS=4242\n"); // no bot token: nothing can be sent
    await sendReadyCards(await s.deps());
    expect(s.sent()).toHaveLength(0);
    expect(s.logs.every((l) => l.includes("ok=false"))).toBe(true);
    await writeFile(s.ws.secretsFile, `TELEGRAM_BOT_TOKEN=${BOT_TOKEN}\nTELEGRAM_ALLOWED_IDS=4242\n`);
    await sendReadyCards(await s.deps());
    expect(s.sent()).toHaveLength(2);
    s.list.splice(1, 1);
    await sendReadyCards(await s.deps());
    expect(JSON.parse(await readFile(s.ws.stateFile, "utf8")).sentCards).toEqual(["pkg-10-2-26"]);
  });

  test("Telegram being down never throws", async () => {
    const s = await setup();
    const send = telegramSender(s.ws.secretsFile, "http://127.0.0.1:1");
    expect(await send("hello")).toBe(false);
  });
});

// Plan 7 Task 5 (D12): a finished pre-air check gets one Telegram line with a link to the signed-in console. Never the
// report's text, never a button: nothing is approved or changed in Telegram.
describe("research cards", () => {
  test("one card per job, link only; two passes, a ready-card pass and a restart send no second card", async () => {
    const s = await setup();
    await sendResearchCards(await s.deps());
    await sendResearchCards(await s.deps());
    await sendReadyCards(await s.deps()); // prunes sentCards to packages in review; must not forget research cards
    await sendResearchCards(await s.deps()); // a restart: fresh memory, same state file
    const texts = s.sent().map((x) => JSON.parse(x.body.toString())).filter((b) => b.text.startsWith("Pre-air"));
    expect(texts.map((b) => b.text)).toEqual([
      "Pre-air verify · 10-30-26\n2 changes · 3 open\nOpen report: https://aircheck.example/research/rj-abc123",
      "Pre-air verify · 10-23-26\n0 changes · 1 open\nOpen report: https://aircheck.example/research/rj-def456",
    ]);
    for (const b of texts) expect(b).not.toHaveProperty("reply_markup");
    const state = JSON.parse(await readFile(s.ws.stateFile, "utf8"));
    expect(state.sentResearch).toEqual(["rj-abc123", "rj-def456"]);
    const lines = s.logs.filter((l) => l.includes("step=research_card"));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(/^publish research=rj-[a-z0-9]+ step=research_card ok=true ms=\d+$/);
  });

  test("done -> queued (Regenerate or Resume) -> done again sends exactly one card; a job not ready yet waits", async () => {
    const s = await setup();
    s.research.splice(1, 1);
    s.research[0] = { ...s.research[0]!, ready: false };
    await sendResearchCards(await s.deps());
    expect(s.sent()).toHaveLength(0);
    s.research[0] = { ...s.research[0]!, ready: true };
    await sendResearchCards(await s.deps());
    s.research[0] = { ...s.research[0]!, ready: false }; // requeued: still listed, so its id is kept
    await sendResearchCards(await s.deps());
    expect(JSON.parse(await readFile(s.ws.stateFile, "utf8")).sentResearch).toEqual(["rj-abc123"]);
    s.research[0] = { ...s.research[0]!, ready: true, changes: 3 };
    await sendResearchCards(await s.deps());
    expect(s.sent()).toHaveLength(1);
  });

  test("a failed send is retried next pass; a job past its 48 hours is forgotten", async () => {
    const s = await setup();
    await writeFile(s.ws.secretsFile, "TELEGRAM_ALLOWED_IDS=4242\n");
    await sendResearchCards(await s.deps());
    expect(s.sent()).toHaveLength(0);
    await writeFile(s.ws.secretsFile, `TELEGRAM_BOT_TOKEN=${BOT_TOKEN}\nTELEGRAM_ALLOWED_IDS=4242\n`);
    await sendResearchCards(await s.deps());
    expect(s.sent()).toHaveLength(2);
    s.research.splice(0, 1);
    await sendResearchCards(await s.deps());
    expect(JSON.parse(await readFile(s.ws.stateFile, "utf8")).sentResearch).toEqual(["rj-def456"]);
  });
});

describe("cardsPass", () => {
  test("ready cards then research cards, each failing alone with its own log step", async () => {
    const s = await setup();
    const deps = await s.deps();
    await cardsPass({ ...deps, convex: { ...deps.convex, awaitingReview: async () => { throw new Error("down"); } } });
    expect(s.logs).toContain("publish package=- step=cards ok=false ms=0");
    expect(s.sent().map((x) => JSON.parse(x.body.toString()).text).filter((t: string) => t.startsWith("Pre-air"))).toHaveLength(2);
    s.logs.length = 0;
    await cardsPass({ ...deps, convex: { ...deps.convex, researchReady: async () => { throw new Error("down"); } } });
    expect(s.logs).toContain("publish package=- step=research-cards ok=false ms=0");
    expect(s.sent().map((x) => JSON.parse(x.body.toString()).text).filter((t: string) => t.startsWith("Rhythm Lab"))).toHaveLength(2);
  });
});

describe("readTelegramSecrets", () => {
  test("reads only the two values; missing file or value is null", async () => {
    const ws = await workspace();
    expect(await readTelegramSecrets(ws.secretsFile)).toBeNull();
    await writeFile(ws.secretsFile, `TELEGRAM_BOT_TOKEN=${BOT_TOKEN}\nTELEGRAM_ALLOWED_IDS= 77 , 88\n`);
    expect(await readTelegramSecrets(ws.secretsFile)).toEqual({ botToken: BOT_TOKEN, chatId: "77" });
    await writeFile(ws.secretsFile, `TELEGRAM_BOT_TOKEN=${BOT_TOKEN}\n`);
    expect(await readTelegramSecrets(ws.secretsFile)).toBeNull();
  });
});
