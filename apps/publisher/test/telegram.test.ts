import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { openState } from "../src/state.js";
import { readTelegramSecrets, sendReadyCards, telegramSender } from "../src/telegram.js";
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
  const fake = fakeConvex([], { review: list });
  const logs: string[] = [];
  const deps = async () => ({
    convex: fake.convex, state: await openState(ws.stateFile), appUrl: "https://aircheck.example/",
    send: telegramSender(ws.secretsFile, server!.base), log: (l: string) => logs.push(l),
  });
  const sent = () => server!.seen.filter((s) => s.path.endsWith("/sendMessage"));
  return { ws, fake, logs, deps, sent, list };
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
