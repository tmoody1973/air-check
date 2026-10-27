import { expect, test } from "vitest";
import { actorFromIdentity } from "../src/index";

const subject = "user_123";

test("no identity gives no actor", () => {
  expect(actorFromIdentity(null)).toBeNull();
});

test("demo role gives a demo actor", () => {
  expect(actorFromIdentity({ subject, role: "demo" })).toEqual({ kind: "demo", userId: subject });
});

test("verified Radio Milwaukee email gives a human actor", () => {
  expect(
    actorFromIdentity({ subject, email: "tarik@radiomilwaukee.org", emailVerified: true }),
  ).toEqual({ kind: "human", userId: subject, email: "tarik@radiomilwaukee.org" });
});

test("unverified Radio Milwaukee email gives no actor", () => {
  expect(
    actorFromIdentity({ subject, email: "tarik@radiomilwaukee.org", emailVerified: false }),
  ).toBeNull();
});

test("look-alike domain gives no actor", () => {
  expect(
    actorFromIdentity({ subject, email: "x@notradiomilwaukee.org", emailVerified: true }),
  ).toBeNull();
});

test("domain match is case-insensitive", () => {
  expect(
    actorFromIdentity({ subject, email: "Tarik@RadioMilwaukee.org", emailVerified: true }),
  ).toEqual({ kind: "human", userId: subject, email: "Tarik@RadioMilwaukee.org" });
});

test("demo role wins even when the email is from the domain", () => {
  expect(
    actorFromIdentity({ subject, role: "demo", email: "tarik@radiomilwaukee.org", emailVerified: true }),
  ).toEqual({ kind: "demo", userId: subject });
});
