import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { generateUniqueId } from "../util-ids.ts";

// generateUniqueId returns the first free random draw and only reaches the
// caller-supplied fallback() when every random attempt collides. The
// round-trip and id-pool tests exercise the happy path (a draw lands free);
// these pin the exhaustion arm so a fallback() that stopped being called —
// or a loop that swallowed a successful draw — would surface here.

test("generateUniqueId: every random draw collides → fallback() value is returned", () => {
  // takenIds.has() answers true for every id, so all randomAttempts collide
  // and the loop falls through to fallback().
  const everythingTaken = { has: () => true };
  let fallbackCalls = 0;

  const id = generateUniqueId({
    prefix: "WAY",
    randomSuffix: () => "AAA",
    randomAttempts: 5,
    takenIds: everythingTaken,
    fallback: () => {
      fallbackCalls++;
      return "WAY-FALLBACK";
    },
  });

  assertEqual(id, "WAY-FALLBACK", "returns the fallback value when all draws collide");
  assertEqual(fallbackCalls, 1, "fallback() is called exactly once");
});

test("generateUniqueId: a free draw short-circuits before fallback()", () => {
  // Nothing is taken, so the very first draw is free and fallback() never runs.
  const nothingTaken = { has: () => false };
  let fallbackCalls = 0;

  const id = generateUniqueId({
    prefix: "WAY",
    randomSuffix: () => "AAA",
    randomAttempts: 5,
    takenIds: nothingTaken,
    fallback: () => {
      fallbackCalls++;
      return "WAY-FALLBACK";
    },
  });

  assertEqual(id, "WAY-AAA", "returns the prefixed random draw");
  assertEqual(fallbackCalls, 0, "fallback() is not called when a draw is free");
});

test("generateUniqueId: zero randomAttempts goes straight to fallback()", () => {
  // With no attempts the loop never runs; fallback() is the only source of an id.
  let drawCalls = 0;

  const id = generateUniqueId({
    prefix: "WAY",
    randomSuffix: () => {
      drawCalls++;
      return "AAA";
    },
    randomAttempts: 0,
    takenIds: { has: () => false },
    fallback: () => "WAY-FALLBACK",
  });

  assertEqual(id, "WAY-FALLBACK", "fallback value returned with zero attempts");
  assertEqual(drawCalls, 0, "randomSuffix() is never invoked with zero attempts");
});

test("generateUniqueId: fallback() exhaustion can throw (sequential-scan policy)", () => {
  // Some id families' fallback() is a scan that throws when truly exhausted.
  // Confirm the thrown error propagates rather than being swallowed.
  let threw = false;
  try {
    generateUniqueId({
      prefix: "WAY",
      randomSuffix: () => "AAA",
      randomAttempts: 3,
      takenIds: { has: () => true },
      fallback: () => {
        throw new Error("id space exhausted");
      },
    });
  } catch (error) {
    threw = true;
    assertEqual((error as Error).message, "id space exhausted", "fallback() error propagates");
  }
  assertTrue(threw, "a throwing fallback() surfaces to the caller");
});
